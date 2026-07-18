# NOTES — schema/protocol deltas vs implementation-plan.md

## Pinned environment (2026-07-15, re-pinned same day)
- codex-cli **0.144.4** (`schemas/CODEX_VERSION.txt`), Node v24.13.0. Previous pin 0.142.4 — replaced because the account-default model `gpt-5.6-sol` requires >= 0.144. Schema diff vs 0.142.4: 74 files changed / 13 added / 1 removed.
- **`approvalPolicy` `"on-failure"` REMOVED in 0.144.4** — valid set is now `untrusted | on-request | never | {granular}`.
- `TurnSteerParams = {threadId, expectedTurnId, input, clientUserMessageId?}`; `ThreadResumeParams = {threadId, ...overrides}`.
- Generated: `codex app-server generate-ts --out ./schemas` + `generate-json-schema --out ./schemas`
- v2 protocol types live in `schemas/v2/`; legacy generation at `schemas/` top level. Both generations present in this build.

## Confirmed as the plan expected
- `initialize` capabilities: `experimentalApi: boolean`, `optOutNotificationMethods: string[]` (`schemas/InitializeCapabilities.ts`).
- Server requests: `item/tool/call`, `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` **plus** legacy `execCommandApproval` / `applyPatchApproval` — handle both generations (plan §2.1/§9.1 was right).
- v2 approval decisions: `accept | acceptForSession | decline | cancel`. Legacy `ReviewDecision`: `approved | approved_for_session | denied | timed_out | abort`. Different enums per generation — the defensive dual handler is mandatory.
- `command/exec` fully validated for the executor (§7.4): `command: string[]` (empty rejected), `processId` (required for `command/exec/terminate`), `timeoutMs`, `cwd`, `env`, `sandboxPolicy`, `streamStdoutStderr` → `command/exec/outputDelta`. Runs standalone, "without creating a thread or turn". Also `command/exec/write`, `command/exec/resize` exist.
- `SandboxPolicy` (turn/exec-level): `{type: "workspaceWrite", writableRoots, networkAccess, excludeTmpdirEnvVar, excludeSlashTmp}` — two extra required-ish fields vs plan's example (`excludeTmpdirEnvVar`, `excludeSlashTmp`).
- `turn/steer`, `turn/interrupt`, `thread/resume`, `thread/fork`, `thread/rollback` all exist. `steer` feature flag is "removed / true" → always on.
- `DynamicToolSpec` (function | namespace variants), `DynamicToolCallParams` `{threadId, turnId, callId, namespace, tool, arguments}`, `DynamicToolCallResponse` all exist in v2 types.
- Binary contains a `thread_dynamic_tools` SQLite table → dynamic tools persist per-thread (restart resilience via `thread/resume` plausible, as plan §5.1 hopes).

## Deltas / traps found (plan text is wrong or unverifiable here)
1. **`approvalPolicy` enum is kebab-case and different words**: `"untrusted" | "on-failure" | "on-request" | "never"` + a `{granular: {...}}` object form (`schemas/v2/AskForApproval.ts`). NOT `unlessTrusted`/`onRequest`. Best candidate for "surface all command approvals" = `"untrusted"` — **must verify empirically in the spike** (that's checklist item: approvalPolicy matrix).
2. **`thread/start` takes `sandbox: SandboxMode`** — a plain string `"read-only" | "workspace-write" | "danger-full-access"` — not the full `sandboxPolicy` object the plan's §3 example shows. The full object shape belongs to `turn/start.sandboxPolicy` and `command/exec.sandboxPolicy`.
3. **`dynamicTools` is NOT in the generated `ThreadStartParams` schema** (nor turn/start, nor initialize). The binary contains the `dynamicTools` JSON field name and full spec types, so the field exists but is emitted only behind `experimentalApi` (schema generator drops experimental fields). **Spike must determine empirically where it goes** — first guess: `thread/start` param as plan §3 shows, with `capabilities.experimentalApi: true` at initialize.
4. **New server request not in the plan's table: `item/tool/requestUserInput`** — must be added to the universal-answer handler (§9.1) with a schema-legal default response.
5. `ThreadStartParams` extras available if useful: `baseInstructions`, `developerInstructions` (alternative/supplement to AGENTS.md steering — could inject the prefetch_verify steering text as developerInstructions instead of relying on repo AGENTS.md; test both in spike), `ephemeral`, `personality`.

## Spike results (2026-07-15 — details in `../spike/spike-findings.md`, raw samples in `../spike/samples/`)
- **GO: G0 passed.** `dynamicTools` attaches as a top-level `thread/start` param (needs `experimentalApi: true`); `item/tool/call` fires; `{contentItems:[{type:"inputText",text}], success:true}` completes the item into the model's flow.
- **approvalPolicy answer: `untrusted`** routes command approvals to the client — except a built-in trusted list (`echo` etc.). Other policies surface zero. Learning path (`item/completed(commandExecution)`) fires at every policy regardless.
- **`command/exec` executor contract fully validated**: workspaceWrite scoping enforced (write outside root → PermissionError), `networkAccess: false` blocks DNS, `command/exec/terminate` works; zero model tokens.
- **Steering compliance pilot: 3/3** — prefetch_verify used for all verification, terminal only for exploration. Full 20+ run still pending.
- **New trap: pin the model with the CLI.** Account default `gpt-5.6-sol` is rejected by codex-cli 0.142.4 ("requires a newer version of Codex", turn-level `error`); spike used `gpt-5.5` (this build's `model/list`: gpt-5.5, gpt-5.4, gpt-5.4-mini).
- **New trap: `commandExecution.command` is a `/bin/zsh -lc '…'` string, not argv** — §6.1 normalizer must strip the shell wrapper; `verb_classes.json` fixtures should be shell strings.

## Session-2 spike results (0.144.4, gpt-5.6-sol — details in `../spike/spike-findings.md`)
- **`turn/steer` (§5.5 fallback): WORKS.** Accepted mid-turn instantly with `expectedTurnId` from the approval params. Consumption is at the **next model-request boundary**: the model finishes its in-flight reaction to the decline (interim "couldn't run" message), then the steer arrives as a `userMessage` item in the same turn, and the model treats the injected output as the command result — no re-run of the declined command. Budget one extra model response cycle per steer.
- **`thread/resume`: PASS.** After a client kill + fresh app-server, `thread/resume {threadId}` restored the thread with dynamic tools intact (no re-registration) — `item/tool/call` round-tripped in the resumed session.
- **Proactive steer (queued before the model's verify attempt): reduces the steer fallback from 3 to 2 model cycles** — decline result + pre-queued steer are consumed in the same next request, no interim message, no re-run. It canNOT eliminate the verify attempt itself (next model request dispatches in ms, faster than any verifier). Push-based injection is unretractable — only steer real, epoch-current results. `thread/inject_items` does not exist in 0.144.4; `turn/steer` is the only mid-turn channel.

## Mining results (2026-07-15 — details in `Mining Instructions.md`)
- **GO on both gates:** top-3 recall **75.4%** (gate ≥40%), executable rate **94.4%** learned-tier / **100%** with TEST heuristic (gate ≥70%). 2,496 trajectories / 105k events, 5 scaffold-model combos, validation split by instance hash.
- `data/pattern_table.json` (84 patterns) independently reproduces the plan §6.2 example shapes. TEST-dominated; TYPECHECK/BUILD priors don't exist in this corpus — online learning carries those (intended demo narrative).
- Runtime-shaped auxiliary: 42.2% of EDIT-trigger speculations (K=2) would be served before the next epoch bump.
- **OOD check vs real Codex spike streams: top-2 recall 23/28 (82%)** — post-edit verification recall 100% (23/23); all 5 misses are pre-edit repro runs from exploration context where the table abstains and no trigger would fire (abstention, not error). `mining/eval_spike.py`.
- Mining = suffix counting, the plan §6.2 sanctioned equivalent of PrefixSpan for contiguous k≤3 windows (gapped patterns can't be looked up by the O(1) suffix hash-map runtime anyway). No PrefixSpan library needed.
- Unskewing via more data is NOT available: the experiments repo's `multilingual` (Java etc.) and `multimodal` (JS/TS) tracks contain no trajectories (only api_calls/cost/resolved stats — verified). Public non-Python shell trajectories are scarce.
- **Event-day implementation note (§6.3 blend fix):** with W_prior=20 applied unconditionally, a context ABSENT from the mined table needs ~11 consecutive online observations before p_eff crosses τ=0.35 (n/(20+n) ≥ 0.35) — this would suppress the JS/TYPECHECK "watch it learn" demo beat. Apply W_prior only to contexts the prior actually contains; for unseen contexts use the online estimate directly (or W_prior ≤ 3). This is the real unskew fix — in the blend, not the data.

## Compliance run complete (2026-07-15): **21/21**
- 21 trials total (3 on gpt-5.5, 18 on gpt-5.6-sol), 3 task shapes, fresh thread + reset repo per trial. 29 prefetch_verify calls served, zero terminal test commands, zero errors, avg turn 31.9s. The §5.4 AGENTS.md steering is validated as the behavioral dependency.

## Still open
- `developerInstructions` as an alternative steering channel untested (optional — AGENTS.md compliance is 21/21).
- Demo repo prep (item 7): pytest repo w/ seeded failure + fresh-history baseline copy (steering text must never enter git history — spike phase G lesson), JS second repo, scripted 3-task A/B list.
