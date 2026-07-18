# Pre-event dynamic-tool validation spike — findings

**Date:** 2026-07-15 · **codex-cli 0.142.4** (pinned, see `schemas/CODEX_VERSION.txt`) · Node v24.13.0 · macOS
**Spike code:** throwaway (lives outside the repo, per plan §1 — artifacts here are the raw request/response samples in `samples/` and this notes file).
**Setup:** toy Python repo (stdlib `unittest`, one seeded bug → 1 failure + 1 error), AGENTS.md steering text from plan §5.4, `prefetch_verify` registered as a function dynamic tool.

## Verdict: GO. The serve path works end-to-end on the pinned build.

## Phase A — G0 registration + round-trip: PASS (`samples/phaseA.summary.json`)

- `dynamicTools: [{type:"function", name, description, inputSchema}]` as a **top-level `thread/start` param** is accepted and registers, with `capabilities.experimentalApi: true` at initialize. (The field is absent from the generated schemas — experimental fields aren't emitted — but the primary placement from plan §3 is correct.)
- The model sees the tool as `functions.prefetch_verify` (verified by having it list its own tools).
- Server request arrives as `item/tool/call` with `{threadId, turnId, callId, namespace: null, tool: "prefetch_verify", arguments: {kind: "test"}}`.
- Responding `{contentItems: [{type: "inputText", text}], success: true}` completes the `dynamicToolCall` item (`status: "completed", success: true`) and the result lands in the model's native tool flow — its final message quoted our canned exit code.

## Phase B pilot — steering compliance: 3/3 (`samples/phaseB.results.json`)

| trial | prompt | prefetch_verify calls | terminal test cmds | suite green after |
|---|---|---|---|---|
| 1 | fix failing test + verify | 2 | 0 | yes |
| 2 | fix bug in average() | 1 | 0 | yes |
| 3 | rename param + verify | 2 | 0 | yes |

- Model used the terminal freely for exploration (`rg`, `sed`, `git status`) but **never** for tests — exactly the split AGENTS.md asks for.
- Trial 3: verification after the rename surfaced the seeded bug → model fixed it → re-verified. The edit→verify→edit→verify loop the predictor mines occurs naturally.
- **Pilot only (n=3).** Remaining 17+ trials: `node spike.mjs phaseB --trials=17` (same harness; results append to `phaseB.results.json`).

## Phase C — approvalPolicy matrix (`samples/phaseC.results.json`)

Prompted each policy to run `echo probe-one` then `python3 -c "print('probe-two')"`:

| policy | approval requests surfaced |
|---|---|
| **`untrusted`** | **1** (`python3 -c …`; `echo` bypassed via built-in trusted list) |
| `on-request` | 0 |
| `on-failure` | 0 |
| `never` | 0 |

**Answer for the plan (§11 kickoff item 2): `untrusted`** — with the caveat that a built-in trusted list (echo, etc.) never prompts, so "ALL commands" is not reachable via policy alone. Approval requests arrived as v2 `item/commandExecution/requestApproval`; `{decision: "accept"}` worked.
**Key consequence:** `item/started`/`item/completed(commandExecution)` notifications fire at **every** policy, so the predictor's learning path and the counterfactual metrics do NOT depend on approvalPolicy. The choice only affects approval-lane richness, confirming plan §3's "the demo must not hinge on the choice".

## Phase D — command/exec executor contract: PASS (`samples/phaseD.results.json`, zero model tokens)

- `command/exec` with `sandboxPolicy: {type:"workspaceWrite", writableRoots:[repo], networkAccess:false, excludeTmpdirEnvVar:false, excludeSlashTmp:false}` ran the suite standalone (exit 1, full output) — no thread/turn needed.
- Write inside `writableRoots`: allowed. Write outside: `PermissionError` (sandbox enforced).
- `networkAccess: false`: DNS resolution blocked (`curl: (6)`).
- `command/exec/terminate {processId}` killed a running exec; its pending response resolved with exit 137.

## Traps discovered (already folded into `documentation/NOTES.md`)

1. **Pin the model with the CLI.** The account default (`gpt-5.6-sol`) is rejected by codex-cli 0.142.4 ("requires a newer version of Codex") — the turn fails with a turn-level `error` notification. Spike pinned `model: "gpt-5.5"` on `thread/start` (this build's `model/list`: gpt-5.5, gpt-5.4, gpt-5.4-mini). See `samples/phaseA.attempt1-modelerror.jsonl`. At the venue: re-check `model/list` and pin explicitly.
2. **`commandExecution.command` is a single string wrapped in `/bin/zsh -lc '…'`**, not an argv array. §6.1 normalization must strip the shell wrapper and parse the string; build `verb_classes.json` fixtures from strings like `/bin/zsh -lc "python3 -m unittest discover"`.
3. `thread/start` takes `sandbox: "workspace-write"` (plain enum); the full `sandboxPolicy` object belongs to `turn/start` / `command/exec`.
4. `UserInput` text items require `text_elements: []`.
5. `account/read` responds with `requiresOpenaiAuth: true` alongside the ChatGPT account — harmless, but don't treat it as "unauthenticated".

---

# Session 2 (2026-07-15, same day) — re-pin to **codex-cli 0.144.4**, steer + resume probes

CLI updated so the account-default model (`gpt-5.6-sol`) works. Schemas regenerated (74 files
changed, 13 added, 1 removed vs 0.142.4; see `schemas/CODEX_VERSION.txt`). Key schema deltas:

- **`approvalPolicy` value `"on-failure"` was REMOVED** in 0.144.4 (it surfaced zero approvals in Phase C anyway). Remaining: `untrusted | on-request | never | {granular}`.
- `TurnSteerParams = {threadId, expectedTurnId, input: UserInput[], clientUserMessageId?}` — `expectedTurnId` is a hard precondition, "request fails when it does not match the currently active turn" (matches plan-with-turn-steer §5.5).
- `ThreadResumeParams = {threadId, ...per-thread overrides}`; also supports resume by history or by rollout path.

## Phase E — decline + `turn/steer` (§5.5 fallback): WORKS, with one timing caveat (`samples/phaseE.results.json`)

Setup: no dynamic tool registered, AGENTS.md removed, `approvalPolicy: "untrusted"`, model `gpt-5.6-sol`. Model prompted to run `python3 -m unittest discover` in the terminal; we declined the approval and sent `turn/steer` (with `expectedTurnId` taken from the approval request params) 50ms later carrying a fabricated "already executed: exit 1 + output tail" message.

- `turn/steer` was **accepted mid-turn instantly** (acked ~1ms after send) against the active turn.
- **Consumption timing: next model-request boundary, not mid-response.** The model first finished its in-flight reaction to the decline (an interim agentMessage: "could not be run… pass/fail is unknown"), *then* the steer text appeared as a new `userMessage` item **within the same turn**, and the model's next message reported our injected result verbatim (right test names, exit code 1).
- The declined item completed `status: "declined"`, `exitCode: null`; the model **did not re-run** the command (`reranAfterDecline: 0`). Turn ended `completed`, ~5.2s decline→completion.
- Implications for `--serve-mode=steer`: viable; budget one extra model response cycle per steer (the interim "couldn't run" message is unavoidable); send the steer immediately after the decline so it is queued before the model's next request.

## Phase F — `thread/resume` restores dynamic tools: PASS (`samples/phaseF.results.json`)

Session 1: thread started with `dynamicTools`, one trivial turn, then the client was killed (crash simulation). Session 2: fresh `codex app-server`, `thread/resume {threadId}` **without re-passing `dynamicTools`** → prompted a `prefetch_verify` call → `item/tool/call` arrived and round-tripped normally. The §9.2 restart-resilience claim holds: dynamic tools persist in the rollout.

## Phase G — PROACTIVE steer (sent at speculative-result time, before the model asks): cuts the fallback to 2 cycles (`samples/phaseG.results.json`)

Setup: no dynamic tool, no AGENTS.md in the working tree, `untrusted`, gpt-5.6-sol. Prompt: fix + verify. On `item/completed(fileChange)` we ran the real verifier (~490ms) and steered immediately with the true result; when the model's `unittest` attempt arrived anyway, we declined.

Timeline: edit landed 01:11:11.05 → steer acked 01:11:11.54 → model's verify attempt 01:11:15.24 (steer had been queued **3.7s earlier**) → declined → **decline result + queued steer consumed in the SAME next model request** (item order: declined exec → userMessage(steer) → reasoning → final answer) → turn done 4.9s after decline.

- **A queued steer does NOT preempt the model's in-flight response.** The next model request dispatches within milliseconds of the previous tool result — faster than any real verifier can finish — so the model's verify-attempt cycle is unavoidable. You cannot get the result in front of the decision to verify.
- **But pre-queuing eliminates Phase E's interim cycle.** Reactive steer (E): attempt → interim "couldn't run" message → final = 3 model cycles. Proactive steer (G): attempt → final = **2 cycles, same as the dynamic-tool serve path**, with no re-run and the final answer quoting the injected result.
- Mode comparison for the same verification: dynamic tool = 2 cycles, native tool-result format, pull-based (nothing injected unless requested — wrong speculation invisible). Proactive steer = 2 cycles, user-role injection, push-based — a stale/wrong steer cannot be retracted, so only steer when the result is real and the epoch is current. Steer mode is now a credible fallback for tool-ignoring models, not a cheaper primary.
- Demo-hygiene catch: the model recovered the deleted AGENTS.md via `git show HEAD:AGENTS.md` and reasoned about the missing helper. For clean A/B baselines the steering text must be absent from git history, not just the working tree.

## Not yet tested

- Full 20+ trial compliance run (pilot 3/3 above, on gpt-5.5/0.142.4; re-run on 0.144.4 + gpt-5.6-sol will refresh both).
- `developerInstructions` as an alternative steering channel.

---

# Session 3 (2026-07-15) — full compliance run: **21/21**

`node spike.mjs phaseB` extended to 21 total trials (3 pilot on gpt-5.5 + 18 on
gpt-5.6-sol, codex-cli 0.144.4), three task shapes cycled, fresh thread + git-reset toy
repo per trial. **21/21 compliant**: all verification through `prefetch_verify` (29 calls
served), zero terminal test commands, zero errors/timeouts, avg turn 31.9s. Raw protocol
logs: `samples/phaseB.jsonl`; per-trial data: `samples/phaseB.results.json`.

These 21 streams double as out-of-distribution predictor validation (`mining/eval_spike.py`):
**top-2 recall 23/28 = 82%** on real Codex events. All 5 misses are the same shape — the
model's FIRST pre-edit repro run from pure exploration context (`GREP/READ → TEST`), where
the table abstains (no prediction) and the runtime would not have triggered (no edit yet).
Post-edit verification recall: **100%** (23/23).
