# Prefetch — Implementation Plan v2 (agent-ready)

Speculative tool execution for OpenAI Codex, built as a standalone `codex app-server` client.
Target: hackathon sponsor track "Best use of API/Codex" + "Save time, save money."

> **Read first — superseded by testing (2026-07):** the architecture below held live, but four
> specs in this doc are stale. Corrections are annotated inline at each spot; details in
> `NOTES.md` and `learnings.md`.
> 1. Tool kinds are **3** (`build` dropped by policy) — §5.1.
> 2. `item/completed.durationMs` is **0 on current builds**; use our executor clocks — §4, §10.1.
> 3. M5 gate redefined: raw hit-rate ≥80% is unreachable (pre-edit repro ask is a structural
>    miss); gate on post-edit serve rate + savedMs — §11.
> 4. A/B repos must be **regenerated fresh per round** (`scripts/make-demo-repo.sh`); reused or
>    doctored git history triggers forensics and can end turns with zero edits — §11.
> Protocol deltas (approvalPolicy enum, thread/start `sandbox` shape, decision values) are
> tracked in `NOTES.md` per §2.1's own convention. Promotion — not full reuse — is the common
> live hit shape; lead metrics with **savedMs**, not leadTime (learnings #6).

---

## 0. Product definition

**One-liner:** While Codex is still reasoning after a code edit, Prefetch has already run the
verification command it is about to ask for — in Codex's own sandbox — and serves the finished
result the moment the model requests it.

**Mechanism provenance:** Client-side implementation of the speculation mechanism from PASTE
(pattern-aware speculative tool execution; arXiv 2603.18897): a mined transition-probability
table predicts the next tool invocation, a budgeted shadow executor runs it speculatively, and a
promotion protocol serves the cached result when the authoritative request arrives. PASTE's
predictor is hash-map lookups over serialized context keys (§12).

Product form:
- **dynamic-tool promotion.** A custom Codex dynamic tool
  `prefetch_verify` is the serve path. Fully documented protocol flow; graceful failure — if the
  model ignores the tool, behavior is exactly vanilla Codex.

---

## 1. Process topology and repo layout

One Node.js (>= 20) TypeScript process. It spawns `codex app-server` as a child over stdio and
owns everything else: protocol client, predictor, scheduler, executor wrapper, cache, metrics,
dashboard HTTP/WS server, and a minimal REPL for driving turns.

```
prefetch/
├── package.json                # type: module; runtime dep: ws (dashboard); dev: typescript, tsx, vitest
├── tsconfig.json
├── schemas/                    # PRE-EVENT ARTIFACT: `codex app-server generate-ts --out ./schemas` (+ json-schema bundle)
├── data/
│   ├── pattern_table.json      # PRE-EVENT ARTIFACT: mined transition table (§6.2)
│   └── verb_classes.json       # PRE-EVENT ARTIFACT: argv-head → command-class map (§6.1)
├── prefetch.config.example.toml
├── AGENTS.md.tpl               # steering text installed into the demo repo (§5.4)
├── src/
│   ├── main.ts                 # CLI entry: arg parse, boot sequence (§3), REPL loop
│   ├── appserver/
│   │   ├── transport.ts        # child spawn, JSONL framing, write queue (§2.2)
│   │   ├── rpc.ts              # typed request(), id mgmt, timeouts, -32001 backoff (§2.3)
│   │   └── router.ts           # dispatch: responses / notifications / server-requests (§2.4)
│   ├── session.ts              # thread + turn lifecycle state machine (§3, §4)
│   ├── approvals.ts            # ALL server-request handlers incl. watchdog (§5.2, §9.1)
│   ├── dyntool.ts              # prefetch_verify registration + item/tool/call promotion (§5)
│   ├── predictor/
│   │   ├── signatures.ts       # event → signature normalization (§6.1)
│   │   ├── table.ts            # pre-mined table load, online counts, blend, checkpoint (§6.2–6.3)
│   │   └── plan.ts             # turn/plan/updated confidence boosts (§6.4)
│   ├── scheduler.ts            # triggers, admissibility, budget, utility, preemption (§7)
│   ├── executor.ts             # command/exec wrapper, timeout, terminate (§7.4)
│   ├── cache.ts                # epochs, entries, staleness, in-flight await (§8)
│   ├── verifiers.ts            # verifier discovery precedence (§5.3)
│   ├── metrics.ts              # counters + event log feeding dashboard (§10)
│   └── dashboard/
│       ├── server.ts           # http static + ws event push (127.0.0.1 only)
│       └── static/index.html   # three-lane timeline + counters (§10.2)
└── test/                       # vitest: framing, cache state machine, signature normalization
```

**Pre-event artifacts** (data/knowledge only — no product code before the event): generated
schemas, `pattern_table.json`, `verb_classes.json`, the AGENTS.md steering text, and written
notes from the pre-event dynamic-tool validation spike (spike code discarded, not reused).
Everything under `src/` is written at the event. If judges ask what was built today: "all
product code; the dataset and protocol validation were research."

---

## 2. Protocol layer

### 2.1 Schemas are the source of truth

First action of the build, against the *venue-installed* Codex version:

```
codex app-server generate-ts --out ./schemas
codex app-server generate-json-schema --out ./schemas
```

Diff against the pre-event copies; review deltas before writing code. Every request param shape,
notification payload, decision enum, and item union in this document is **indicative** — if a
generated type disagrees (field name casing, enum values, method names), follow the schema and
record the delta in `NOTES.md`. Known historical traps: approval server-request method names
changed from legacy `execCommandApproval` / `applyPatchApproval` to
`item/commandExecution/requestApproval` / `item/fileChange/requestApproval`; decision values are
camelCase `accept | acceptForSession | decline | cancel` (NOT `approved` / `denied`). Handle
both generations of method names defensively (§9.1).

### 2.2 Transport (`transport.ts`)

- `spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"] })`.
- Wire format: JSON-RPC 2.0 **with the `"jsonrpc":"2.0"` header omitted** ("JSON-RPC lite").
  One JSON object per line (JSONL) on stdin/stdout.
- Reader: `readline` over child stdout; each line → `JSON.parse` → router. A parse failure logs
  the raw line and continues; never crash the loop on one bad line.
- Writer: serialize + `\n`, single write queue (no interleaved partial writes).
- Child exit → fatal to the session UI; the client IS the loop, there is no degraded mode
  without the server. Keep this layer boring and total.

### 2.3 RPC core (`rpc.ts`)

- Monotonic integer `id` per outgoing request; `Map<id, {resolve, reject, method, sentAt}>`.
- Inbound classification:
  - has `id` + (`result` | `error`), id ours → response.
  - has `id` + `method` → **server-initiated request** (MUST be answered; §2.4, §9.1).
  - has `method`, no `id` → notification.
- Per-request timeout (default 30s; `command/exec` uses its own `timeoutMs` + 10s grace).
- Overload: JSON-RPC error `-32001` ("Server overloaded; retry later") → retry with exponential
  backoff + jitter (base 250ms, cap 5s, max 5 attempts). Coupling: while backoff is active, the
  scheduler pauses NEW speculative launches (speculation is best-effort by construction;
  authoritative traffic gets the headroom).

### 2.4 Router (`router.ts`)

Single dispatch table registered at boot. Unknown notifications: logged, dropped. Unknown
**server-requests: answered** with the safest schema-legal default, never ignored — an
unanswered server request hangs the turn (the #1 stall bug class in third-party app-server
clients).

Notification routing (v2 names; consult schema):

| method | handler | purpose |
|---|---|---|
| `thread/started`, `thread/status/changed`, `thread/closed` | session | lifecycle bookkeeping |
| `turn/started` | session, metrics | open turn record, start turn clock |
| `turn/completed` | session, metrics, cache, predictor | close turn, flush lanes, checkpoint counts |
| `turn/plan/updated` | predictor/plan | confidence boosts (§6.4) |
| `turn/diff/updated` | cache, scheduler | epoch bump (§8.2), corroborating trigger (§7.1) |
| `item/started` (commandExecution) | metrics, approvals | render pending command; correlate approval |
| `item/completed` (commandExecution) | predictor/table, verifiers, metrics | online learning sample; learned-verifier update; authoritative `durationMs` ground truth |
| `item/started`/`item/completed` (fileChange) | scheduler, cache | speculation trigger; epoch bump |
| `item/completed` (contextCompaction) | metrics | display only |
| `item/reasoning/summaryTextDelta` | dashboard | "model thinking" lane — display ONLY, never a predictor dependency (raw reasoning text is model-dependent) |
| `item/agentMessage/delta` | (opted out at initialize) | suppressed |
| `item/commandExecution/outputDelta` | dashboard (optional) | live output pane |
| `thread/tokenUsage/updated` | metrics | cost lane |
| `serverRequest/resolved` | approvals | clear pending bookkeeping |
| `error` (turn error event) | session, dashboard | surface `codexErrorInfo` (ContextWindowExceeded, SandboxError, UsageLimitExceeded, …) |

Server-request routing → §9.1: `item/tool/call`, `item/commandExecution/requestApproval`,
`item/fileChange/requestApproval`, `item/permissions/requestApproval`, legacy
`execCommandApproval` / `applyPatchApproval`, plus a schema-legal error responder for anything
else.

---

## 3. Boot sequence (`main.ts` + `session.ts`)

1. Load config (`prefetch.config.toml` if present), `data/pattern_table.json`,
   `data/verb_classes.json`, per-repo state (`.prefetch/state.json`: learned verifiers + online
   counts from prior sessions). Run verifier discovery (§5.3) against `--cwd` (default: process
   cwd; must be a git repo).
2. Start dashboard on `127.0.0.1:7717` (http static + ws). Print URL.
3. Spawn app-server (§2.2).
4. `initialize`:

```json
{ "method": "initialize", "id": 0, "params": {
  "clientInfo": { "name": "prefetch", "title": "Prefetch", "version": "0.2.0" },
  "capabilities": {
    "experimentalApi": true,
    "optOutNotificationMethods": ["item/agentMessage/delta"]
  }
} }
```

   `experimentalApi: true` is REQUIRED for `dynamicTools`. Keep the opt-out list minimal —
   reasoning summaries and command output deltas feed the dashboard.
5. `initialized` notification.
6. `account/read` → if unauthenticated, print "run `codex` and log in first" and exit. Do not
   implement login flows.
7. `model/list` → pick default (or `--model`).
8. `thread/start`:

```json
{ "method": "thread/start", "id": 2, "params": {
  "model": "<selected>",
  "cwd": "<repo root>",
  "approvalPolicy": "<see below>",
  "sandboxPolicy": { "type": "workspaceWrite", "writableRoots": ["<repo root>"], "networkAccess": false },
  "serviceName": "prefetch",
  "dynamicTools": [ <prefetch_verify definition — §5.1> ]
} }
```

   **approvalPolicy — verify at kickoff (§11 checklist):** documented values seen include
   `never`, `unlessTrusted`, `onRequest`. Approvals are observability only (we
   auto-accept), so the default is acceptable and the demo must not hinge on the choice.
9. Record `threadId`; read `thread.sessionId` from the result per docs (don't derive it).
10. REPL: each line → `turn/start` with `[{type:"text", text:<line>}]`. Ctrl-C during an active
    turn → `turn/interrupt` + executor terminates all in-flight speculative execs.

Session state machine: `IDLE → TURN_ACTIVE → (completed | failed | interrupted) → IDLE`. One
active turn per thread. The cache is thread-scoped (results may survive across turns; epochs
guard correctness, §8.2).

---

## 4. Turn lifecycle (end-to-end)

```
user prompt ─► turn/start
  ◄─ turn/started
  ◄─ item/reasoning/summaryTextDelta*        (dashboard lane 1)
  ◄─ turn/plan/updated                       (predictor boost §6.4 — OPTIONAL; may never fire)
  ◄─ item/started(fileChange) … item/completed(fileChange)
        └► cache.bumpEpoch()                 (§8.2)
        └► scheduler.onTrigger()             (§7.1)
              └► predictor.predict(lastK)    (§6) → candidates [(TEST,0.78),(TYPECHECK,0.41)]
              └► executor: command/exec per admissible candidate, budgeted (§7)
                    └► cache.put(inflight → done)
  ◄─ item/started(dynamicToolCall prefetch_verify)
  ◄─ item/tool/call  (SERVER REQUEST)        → promotion protocol (§5.2)
  ◄─ item/completed(dynamicToolCall)         → result in the model's native tool flow
  ◄─ … more items / further edit→verify iterations …
  ◄─ turn/completed                          (metrics flush; token lane; predictor checkpoint)
```

Fallback path when the model ignores the tool and uses its terminal:
`item/started(commandExecution)` → `item/commandExecution/requestApproval` → `accept`
immediately → `item/completed{durationMs}` → predictor learns the transition, verifiers.ts may
update the learned argv map, and metrics record the counterfactual ("cache had this result N s
before the request") WITHOUT serving. Graceful-failure property: worst case equals vanilla
Codex. This observability path is mandatory — it feeds learning and ground-truth
timing; do not cut it.

---

## 5. Serve path: the `prefetch_verify` dynamic tool

### 5.1 Definition

Registered via `dynamicTools` on `thread/start` (experimental API; envelope per generated
schema). Contract:

- name: `prefetch_verify` (respect Responses-API naming constraints; avoid reserved namespaces)
- description: "Run the project's verification commands (tests, lint, typecheck, build).
  Returns exit code and output identical to running the command in the terminal, often
  instantly."
- parameters (JSON Schema):

```json
{ "type": "object",
  "properties": {
    "kind":  { "type": "string", "enum": ["test", "lint", "typecheck"] },
    "scope": { "type": "string", "description": "optional path or test filter; omit for whole repo" }
  },
  "required": ["kind"], "additionalProperties": false }
```

MVP may ignore `scope` (always whole-repo); if so, say that in the description. Do NOT expose
arbitrary argv through the tool. Dynamic tools persist in the thread rollout and restore on
`thread/resume` — restart resilience for the demo (spike phase F: verified).

**Updated (learnings #11):** `build` removed from the enum by policy, not omission — side-effect
kinds are excluded from speculation; test carries nearly all hideable wait; the mined prior for
BUILD doesn't exist (5 events in 105k). Kickoff G0 re-validates this *changed* contract.

### 5.2 `item/tool/call` handler — the promotion protocol

On server request `item/tool/call` for `prefetch_verify(kind, scope?)`:

```
key   = cacheKey(kind, canonicalArgv(kind), scope)
entry = cache.get(key)

1. entry.status == done  AND entry.epoch == cache.currentEpoch      → FRESH HIT
     respond immediately with formatted result.
     metrics: hit, leadTime = requestAt − finishedAt, waitAvoided = full duration.
2. entry.status == inflight AND entry.epoch == cache.currentEpoch   → PROMOTION
     await entry.promise with deadline = remaining exec timeout;
     respond on resolve. metrics: partial hit, waitAvoided = now − spawnedAt at request time.
3. no entry OR stale epoch                                          → MISS
     run authoritatively through the SAME executor (command/exec); respond when done.
     metrics: miss; if a stale entry existed, add its runtime to wastedSpecSeconds.
4. executor failure (spawn error, timeout, sandbox error)           → STRUCTURED FAILURE
     respond: exitCode null + "prefetch_verify failed to execute: <reason>. You may run the
     command manually in the terminal." The model chooses its next action.
```

Response content (text; shape per schema):

```
verifier: python -m pytest -q        (kind=test)
exit code: 1
duration: 6.4s   [served from speculative run completed 4.9s before this request]
--- output (tail, 200-line / 16KB cap; N lines truncated) ---
<stdout+stderr tail — tail-biased because test failures print last>
```

Full output is retained in the cache and viewable in the dashboard. The subsequent
`item/completed(dynamicToolCall)` carries this result into the model's native tool-call flow —
the documented, in-protocol equivalent of PASTE's promotion.

### 5.3 Verifier discovery (`verifiers.ts`) — argv per kind

Precedence (first hit wins); computed at boot, re-checked when relevant files change:

1. **Explicit config** — `prefetch.config.toml`:

```toml
[verifiers]
test      = ["python", "-m", "pytest", "-q"]
lint      = ["ruff", "check", "."]
typecheck = ["pyright"]
build     = ["python", "-m", "compileall", "-q", "."]
```

2. **Learned** — most recent SUCCESSFULLY OBSERVED authoritative command whose normalized class
   (§6.1) maps to the kind; persisted in `.prefetch/state.json`. This is what makes the tool
   self-configuring: `item/completed(commandExecution)` → classify → remember argv per kind.
   The demo narrative depends on this tier existing ("it learned this repo's verifier by
   watching"), so it is IN scope, not stretch.
3. **Ecosystem heuristics** — `package.json.scripts.test` → `["npm","test","--silent"]`;
   `pytest.ini` / `pyproject[tool.pytest]` → pytest; `Cargo.toml` → `cargo test` /
   `cargo check`; `go.mod` → `go test ./...`; `tsconfig.json` → `tsc --noEmit`. Small table.

If a kind resolves to nothing, the tool response says so explicitly. Never invent an argv.

### 5.4 Model steering (`AGENTS.md.tpl`, installed into the demo repo)

```markdown
## Verification
This workspace provides a `prefetch_verify` tool. Whenever you need to run tests, lint,
typechecking, or a build to verify your changes, ALWAYS call `prefetch_verify` with the
appropriate kind instead of running those commands in the terminal. It executes the exact same
command in the same sandbox and returns the exit code and output — usually much faster, because
the result may already be prepared. For all other commands, use the terminal normally.
```

Model compliance with this is the behavioral dependency (validated pre-event). Judge
answer for "what if the model ignores it": it runs the terminal command normally, Prefetch
auto-accepts, and behavior is exactly vanilla Codex — asymmetric, graceful failure.

### 5.5 Experimental mode: decline + steer

Only behind --serve-mode=steer. On item/commandExecution/requestApproval whose normalized
argv matches a fresh cache entry: respond decline, then turn/steer with
expectedTurnId = <turnId from the request> and text: "Do not re-run <cmd> — it was already
executed <t>s ago in the same sandbox. exit code <n>. Output: <tail>. Treat this as the command
result and continue." Documented facts limiting this mode: steer appends USER INPUT, not a
command result; a declined item completes status: declined; no response field substitutes
output for a declined command; thread/inject_items appends Responses items for SUBSEQUENT
model requests (usable between turns only). thread/shellCommand is BANNED from this design
entirely — it runs outside the sandbox with full access and is intended for explicit
user-initiated commands. This needs to be tested before the hackathon.

---

## 6. Predictor (transition table)

### 6.1 Signatures and normalization (`signatures.ts`)

Each observed event → compact signature, PASTE-style (metadata only, payloads stripped):

- `fileChange` → `EDIT(<ext-class>)`, ext-class ∈ {py, ts/js, rs, go, config, other}.
- `commandExecution` → `<CLASS>(<status>)`. CLASS from `data/verb_classes.json` after argv
  canonicalization: strip `bash -lc`, env-var prefixes, interpreter wrappers (`python -m`,
  `node`), package runners (`npx`, `uvx`, `pnpm dlx`); classify on head verb + salient
  subcommand → class ∈ {TEST, LINT, TYPECHECK, BUILD, GREP, READ, GIT_RO, INSTALL, RUN, OTHER}.
  Examples: `python -m pytest -q` → TEST; `npm test` → TEST; `ruff check .` → LINT;
  `tsc --noEmit` → TYPECHECK; `git status --short` → GIT_RO.
- `dynamicToolCall(prefetch_verify)` → `VERIFY(<kind>)` (treated as the kind's class for
  learning purposes: a served TEST is still an observed TEST transition).

Context key = ordered sequence of the last k=3 signatures within the turn, serialized:
`"EDIT(py)|TEST(failed)|EDIT(py)"`.

`verb_classes.json` (pre-event artifact) is the canonical head-verb → class map, including
common multi-token forms; unit-test it against a fixture list of real observed argv strings.

### 6.2 Pre-mined table (`data/pattern_table.json` — pre-event artifact)

Mined offline from public agent trajectories (SWE-bench experiments submissions, OpenHands
evaluation outputs) using the SAME signature scheme, PASTE Algorithm-1 style: per target class,
collect preceding signature subsequences (length ≤ k), frequent-subsequence mine (PrefixSpan or
plain suffix counting for k ≤ 3), validate p on held-out traces, keep patterns with
support ≥ σ and p ≥ τ.

```json
{ "k": 3, "minSupport": 20, "tau": 0.35,
  "patterns": [
    { "context": ["EDIT(py)"],                              "predicts": "TEST",      "p": 0.61, "support": 412 },
    { "context": ["EDIT(py)", "TEST(failed)", "EDIT(py)"],  "predicts": "TEST",      "p": 0.83, "support": 187 },
    { "context": ["EDIT(ts/js)"],                           "predicts": "TYPECHECK", "p": 0.44, "support": 156 },
    { "context": ["TEST(failed)"],                          "predicts": "TEST",      "p": 0.57, "support": 391 }
  ] }
```

Runtime: hash-map from every suffix of the last-k window → candidate list sorted by p. Constant
time. `predict(context)` returns candidates with blended p ≥ τ, top-K (K=2 — with a 4-kind
vocabulary, "top-3 speculation" degenerates to "run the two likeliest kinds").

### 6.3 Online learning

Every `item/completed(commandExecution | dynamicToolCall)` appends an observation
`(contextBefore → class, status)` and increments in-memory transition counts. Effective
probability is a Laplace-smoothed blend of prior and online estimates:

```
p_eff = (W_prior * p_prior + n_online * p_online) / (W_prior + n_online),   W_prior = 20
```

Checkpoint counts to `.prefetch/state.json` every 30s and at `turn/completed` / exit (PASTE:
in-memory summaries "updated online and checkpointed periodically"). The dashboard shows live
hit rate and a "learned this session" pattern list — the judge answer to "did you hardcode
this?" is: prior mined from ~thousands of public trajectories + live adaptation from THIS
session, and the adaptation is visible on screen.

### 6.4 Plan hints (`plan.ts`) — boost, never a dependency

On `turn/plan/updated`, scan pending/inProgress step text for {test, verify, run suite, lint,
type, build} keywords → multiply matching candidates' p_eff by 1.5 (cap 0.99) for the rest of
the turn. `turn/plan/updated` fires only when the agent shares or changes a plan — it may never
fire. The fileChange trigger alone must carry the demo.

---

## 7. Speculation scheduler (`scheduler.ts`)

### 7.1 Triggers

- Primary: `item/completed(fileChange)`; `turn/diff/updated` as corroboration. Debounce 350ms so
  an edit burst yields ONE trigger carrying the final epoch.
- On trigger: `epoch = cache.currentEpoch` (post-bump), context = last-k signatures,
  `candidates = predictor.predict(context)`.

### 7.2 Admissibility (declared policy — never inferred)

```toml
[speculation]
allow = ["TEST", "LINT", "TYPECHECK", "BUILD"]   # class allow-list; everything else denied
max_concurrent = 2
default_timeout_ms = 120000
network = false                                   # speculative execs NEVER get network
```

Only allow-listed classes run speculatively, each via its §5.3 argv. No side-effect inference,
ever (PASTE: policy bounds are declared; side-effect freedom is not inferred automatically).
Speculative sandbox: same shape as the thread (`workspaceWrite`, repo root writable — test
runners write caches) with `networkAccess: false` unconditionally.

### 7.3 Budget, ordering, dedupe, preemption

- Slots: `max_concurrent = 2`. Launch order by utility `U = p_eff * T̂ / (c * d̂)` where `T̂` =
  EWMA of observed durations per class (seed 10s), `c = 1`, `d̂ = T̂` → order reduces to p_eff;
  keep the formula in code and docs (it is the PASTE citation, and T̂ feeds the dashboard).
- Dedupe: one in-flight per cache key; trigger on an existing fresh/in-flight key is a no-op.
- Preemption: authoritative work always wins. When an authoritative exec (miss path, §5.2 case
  3) needs a slot, terminate the lowest-U speculative exec via `command/exec/terminate`
  (by `processId`). Also terminate ALL speculative execs on `turn/interrupt` and on epoch bump
  (their results would arrive stale).
- Backoff coupling: while `-32001` backoff is active, no new speculative launches (§2.3).

### 7.4 Executor (`executor.ts`)

Thin wrapper over `command/exec`:

```json
{ "method": "command/exec", "id": N, "params": {
  "command": ["python", "-m", "pytest", "-q"],
  "cwd": "<repo root>",
  "sandboxPolicy": { "type": "workspaceWrite", "writableRoots": ["<repo root>"], "networkAccess": false },
  "timeoutMs": 120000,
  "processId": "spec-<uuid>"
} }
```

Result `{exitCode, stdout, stderr}`. `processId` retained for terminate. Reject empty argv
locally. `streamStdoutStderr: true` + `command/exec/outputDelta` only if the dashboard's live
output pane is built (optional).

`command/exec` uses the same sandbox-policy *shape*, same cwd, and same
sandbox machinery as the thread's commands. It does not join Codex's internal execution
state.

---

## 8. Result cache (`cache.ts`)

### 8.1 Entry

```ts
type VerifierKind = "test" | "lint" | "typecheck" | "build";
interface CacheEntry {
  key: string;              // hash(kind + canonical argv + scope)
  epoch: number;            // repo-state epoch at spawn
  kind: VerifierKind;
  argv: string[];
  status: "inflight" | "done" | "failed";
  promise: Promise<ExecResult>;
  exitCode?: number; stdout?: string; stderr?: string;
  spawnedAt: number; finishedAt?: number;
  execProcessId: string;
}
```

### 8.2 Epoch rule (the MVP correctness invariant)

`currentEpoch` is a monotonic counter, incremented on EVERY completed `fileChange` item and on
each `turn/diff/updated` carrying new content. An entry is servable iff
`entry.epoch === currentEpoch` — i.e., zero repo mutations between spawn and request. Anything
else is stale: never served, its runtime counted into `wastedSpecSeconds`, its exec terminated
if in flight. This deliberately over-invalidates (an unrelated edit kills a valid test result);
that is acceptable — the cache can never serve a wrong result. `fs/watch` for out-of-band edits
is explicitly OUT of scope.

### 8.3 TTL: entries additionally expire 10 minutes after finish. Serving decisions: §5.2.

---

## 9. Failure semantics (make these total before adding features)

### 9.1 Universal server-request answering (`approvals.ts`)

Invariant: EVERY inbound message bearing `id`+`method` receives a response within 5s (watchdog),
always. Handlers:

| server request | Response | notes |
|---|---|---|
| `item/tool/call` (prefetch_verify) | promotion protocol §5.2 | watchdog fallback: structured failure content |
| `item/commandExecution/requestApproval` | `accept` (observe-only) |  |
| `item/fileChange/requestApproval` | `accept` | edits are not our concern |
| `item/permissions/requestApproval` | `decline` | never silently escalate permissions mid-turn |
| legacy `execCommandApproval` / `applyPatchApproval` | as modern equivalents | older server builds |
| anything unrecognized | schema-legal error response | logged loudly; NEVER ignored |

Approval requests carrying `networkApprovalContext` are network prompts, not shell prompts:
`accept` for the demo repo's known hosts, `decline` otherwise; render distinctly in the lane.

### 9.2 Other failure paths

- Turn `error` event → show `codexErrorInfo` in lane 1; turn ends `failed`; scheduler and
  in-turn state reset; cache persists (epochs still guard it).
- Dashboard/WS failure → never blocks the protocol loop (fire-and-forget pushes).
- Client crash mid-turn → acceptable at a hackathon; on restart, `thread/resume <threadId>`
  restores the thread and its dynamic tools (they persist in the rollout).
- Speculative failure is invisible to the model by design: failed speculation = `failed` entry
  = miss on request = authoritative run. Speculation can never make a turn worse — only the
  dashboard sadder.

---

## 10. Metrics + dashboard

### 10.1 Counters (session and per-turn)

- `verificationDurationMs` — from our own executor timings ONLY. (`item/completed.durationMs`
  reports 0 on current codex builds — learnings #7; never source metrics from it.)
- `leadTimeMs` — tool-request time − speculative `finishedAt` (how early the result was ready).
- `waitAvoidedMs` — fresh hit: full verification duration; promotion: elapsed-since-spawn at
  request time.
- `wastedSpecSeconds` — CPU seconds of terminated / stale / never-requested speculative runs.
- `hitRate` — hits / (hits + misses) over prefetch_verify calls; plus the counterfactual counter
  from the terminal fallback path (§4) — "results that were ready but not served."
- `tokensUsed` — from `thread/tokenUsage/updated`; proves the "+0 extra tokens" claim on screen.

### 10.2 UI — three synchronized lanes on one timeline (the demo IS this screen)

```
CODEX      ── reasoning ── plan ── edit app.py ────────── prefetch_verify(test) ── continue
PREDICTOR  ─────────────── EDIT(py)→TEST p=0.78 ▲plan · TYPECHECK p=0.41 (below τ×slots)
EXECUTOR   ──────────────── pytest -q [spec] ▓▓▓▓ done exit1 6.4s ──── HIT served (lead 4.9s)
                             counters: wait avoided 4.9s · wasted 0.0s · hit rate 100% · +0 tokens
```

Static HTML + vanilla JS + one SVG/canvas timeline over a WS event feed. No framework. A
"baseline mode" toggle records identical lanes with speculation disabled, for the A/B trial.
Include a "learned this session" panel listing online-updated patterns with counts (§6.3 —
the anti-"hardcoded" exhibit).

---

## 11. Build order, gates, demo

Event-hour plan (team of 3–4; workstreams parallelize after M1):

| # | window | deliverable | gate |
|---|---|---|---|
| M0 | 0:00–0:20 | schemas regenerated on venue-installed Codex; diff vs pre-event schemas reviewed | — |
| M1 | 0:20–0:50 | transport + rpc + router; handshake; one `turn/start` round trip; ALL server requests answered with defaults | **G0:** dynamic tool registers and one `item/tool/call` round-trips with a canned result (pre-validated; this is re-confirmation). |
| M2 | 0:50–1:50 | executor + cache (epochs, promotion await, TTL) + verifier discovery tiers 1+3 | cache state-machine unit tests pass |
| M3 | 1:50–2:50 | scheduler (trigger, allow-list, budget=2, dedupe, terminate) + predictor (table load, suffix lookup, online counts + blend, plan boost) + learned-verifier tier 2 + normalization against fixture argv list | E2E: edit file in demo repo → 2 speculative candidates launch → tool call served from cache; second E2E: unseen verifier command observed once → learned → speculated on next edit |
| M4 | 2:50–3:50 | dashboard: lanes, counters, baseline toggle, learned-patterns panel | screen readable from 3 meters |
| M5 | 3:50–4:30 | A/B trials (scripted 3-task list, 3 runs each mode, **fresh repo per round** via `scripts/make-demo-repo.sh`); freeze numbers | **post-edit serve rate ≥ 80% + savedMs > 0 every steered round.** (Raw hit rate can't reach 80%: the pre-edit repro ask is a structural cold-start miss — learnings #5. Report raw rate with that caveat; headline = total savedMs.) |
| M6 | 4:30–5:00 | polish; failure-path demo (kill Prefetch's scheduler mid-turn → vanilla behavior); pitch rehearsal | — |

Demo repo: Python; pytest suite completing in 3–6s (confirmed by experience — learnings #4);
one seeded failing test; AGENTS.md from §5.4 checked in. Scripted prompt: "Fix the
failing test in <module> and verify." Second demo beat: run once on a JS repo to show the
learned-verifier tier picking up `npm test` with zero config.

**Repo hygiene is load-bearing (learnings #1, #2, #10):** REGENERATE the repo fresh for every
run via `scripts/make-demo-repo.sh` — single initial commit, bug present from commit 1, never
reseed on top of history (codex does commit-by-commit forensics and may end the turn with zero
edits). `.gitignore` for `__pycache__`/`.prefetch` from the first commit (binary files break
apply_patch reads). Name repos like real projects (pricing-utils), not like test rigs. Baseline
mode: `--baseline` variant — no dynamic tool, no AGENTS.md, steering text never in git history.

Kickoff verification checklist (docs don't pin these down — test, don't assume):
1. **G0** dynamic-tool round trip on the venue build.
2. Which `approvalPolicy` value surfaces all command approvals (observability lane richness for the experimental mode).
3. `turn/steer` consumption timing mid-turn (experimental mode probing).

---

## 12. Explicit non-goals (do not build)

- **Any ML/LM predictor.** The predictor is a transition table. PASTE's own predictor is
  hash-map lookups over serialized context keys; its reported 93.8% hit rate coexists with
  27.8% Top-1 accuracy because multi-candidate speculation under a budget does the work —
  sophistication in the predictor is not where the value is.
- PrefixSpan at runtime — mining is a pre-event offline step; runtime is lookup + counting.
- `thread/shellCommand`, anywhere, for anything.
- Own sandboxing / git worktrees — `command/exec` is the executor.
- Speculating anything off the allow-list, anything with network access, or any LLM call.
- Multi-thread / multi-session scheduling; WebSocket transport (stdio only); Windows.
- Cursor integration (out of track; the earlier Cursor-plugin design is archived in v1 history).
