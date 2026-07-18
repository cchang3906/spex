# design

Spex is a single JavaScript daemon, one process, zero dependencies, no build step. It launches `codex app-server` as a child process and speaks JSON RPC to it over stdio. Codex is never modified, forked, or patched: everything flows through the public protocol, and removing the daemon leaves Codex exactly Codex. The whole system is a control plane wrapped around an agent we do not own.

## shape

- `src/main.mjs` boots transport, predictor, verifiers, scheduler, executor, cache, serve handler, and event feed, then registers exactly one dynamic tool at thread start: `prefetch_verify`.
- A repo opts in with one steering file (AGENTS.md) that routes verification through the tool. That is the entire integration cost.
- Every event the daemon emits streams simultaneously to the CLI renderer (`src/cli.mjs`), a localhost dashboard over server sent events (`src/dashboard.mjs`), and a jsonl log. The demo, the metrics, and the benchmark read the same single source of truth.

## the predictor

Next step candidates come from hash map lookups over serialized context keys: the last k tool signatures of the live session form a string key, and a pattern table mined from 2146 real agent trajectories answers what usually comes next and how often. Constant time per lookup, about a hundred nanoseconds, no model, no inference. Online counts blend with the mined prior during the session, so a repo's local habits sharpen the table while it runs. A bench clean variant of the table, mined with all benchmark instances excluded, is selected via `SPEX_TABLE` for measurement.

Arguments are never predicted from context. Verification commands are repo facts, so a three tier lookup resolves them: repo config detection, a command observed in this session (persisted across restarts in `.prefetch/verifiers.json`), or a stack default. No resolution means no launch, silently.

## the scheduler

Two lanes share one executor. Agent issued invocations run in the authoritative lane exactly as Codex intended; admitted predictions run in a speculative lane bounded by a two slot budget. Four gates guard admission: a concrete resolvable command, the allow list (test, lint, typecheck, build only), confidence at least tau 0.35, and a free budget slot. Failing any gate abstains silently. Admitted work is deduplicated by command, directory, and epoch, and ranked by expected value, probability times expected runtime, so the most useful run gets the slot.

Two triggers launch speculation:

- a file change: the post edit verify, predicted from the pattern table.
- session start: the cold start pre run. Reproducing the failing state is the most predictable act in a session, so the suite is pre run at epoch 0 before the model says a word, converting the entire first suite duration into head start instead of dead first miss.

## the cache

Results are keyed by kind and epoch. Every file change bumps the epoch; entries and in flight runs from older epochs can never serve. When Codex calls the tool and a completed fresh entry exists, it is served in milliseconds. When the matching speculation is still running, the request joins it, the job is promoted to authoritative priority, and the answer arrives the moment the run finishes, having banked its head start. When nothing matches, the command runs normally and Codex experiences plain Codex. savedMs is min(duration, ask minus launch), computed from real clocks at serve time.

## safety

Wrong guesses cost laptop CPU, never correctness and never tokens. Speculative results are quarantined until Codex explicitly asks; nothing is ever injected into the conversation. Only allow listed verification commands run early, in the same sandbox Codex itself uses. Discarded and preempted runs are counted honestly in the event stream as wasted CPU seconds, reported next to the savings. One disclosed token exception: the first time Spex meets a repo where no verifier resolves, it answers "no verifier known yet" once, which costs a single tool exchange and teaches the learned tier permanently.

## repo map

```
speculator/src/       daemon, cli renderer, dashboard
speculator/test/      unit tests, node --test
speculator/evals/     simulation suite, results, benchmark plan
speculator/scripts/   a/b benchmark harness, repo generator, trace formatter
speculator/bench-runs/  raw event trace per run, formatted timelines, extraction map
mining/               corpus to pattern table, plus the offline recall evals (repo root)
data/                 pattern tables, benchmark instances, normalized corpora (repo root)
```

## reproduce

```
node --test                              unit tests
python3 mining/eval.py                   offline recall, held out trajectories
python3 mining/eval_spike.py             recall on out of distribution codex sessions
node scripts/bench.mjs 1 --swebench      live a/b benchmark on swe bench verified
node scripts/format-trace.mjs            regenerate readable trace timelines
```
