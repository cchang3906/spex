# Spex

Speculative execution for coding agents. Tool calls run while the model is still thinking, and the answers are waiting when it asks.

## The serial-loop problem

Coding agents usually edit, request verification, wait for the terminal, and only then continue reasoning. Tests, lint, and type checks are often predictable from the repository and recent tool sequence. That wait sits directly on the model's critical path.

Spex predicts the exact verifier and starts it in a bounded shadow queue. When the model asks for that command, Spex can return the completed terminal result immediately. A wrong prediction uses local compute but stays quarantined and invisible.

## Sealed benchmark

The committed benchmark covers 42 SWE-bench instances from 7 repositories, with paired Spex and baseline arms for 84 sealed runs. It is larger and harder than the previous 25-instance set. Every number comes from [the generated trace report](speculator/evals/harder-sealed-report.md).

| Measure | Spex | Baseline | Result |
| --- | ---: | ---: | ---: |
| Runs | 42 | 42 | 84 total |
| Trace wall | 2,338,733 ms | 2,715,988 ms | 13.9% less |
| Verification calls | 110 | 67 | 64% more with Spex |
| Resolved | 38/42 | 38/42 | identical |

Spex served 88 of 110 verification requests, an 80% serve rate, and hid 44,592 ms of verifier time. Savings rise with vetted suite cost, reaching 6.6 seconds of `savedMs` in one agent call. The agent verified 64% more and still finished faster because a served verification is nearly free on its critical path.

Resolution was 38/42 in both arms. This is the lossless result: Spex reduced measured wall time without changing what the agent solved. All 84/84 runs contain both sandbox seal receipts, with 0 workspace escapes and 0 flagged outside-workspace reads.

The serve rate reflects the intended repository convention, which pins the exact verification command used by cold start and by the model. It will be lower when that convention is absent.

## How Spex works

- Predict the next allow-listed verification command from repository conventions and recent tool use.
- Start likely commands in a shadow queue with a speculative budget of 2.
- Cold-start the pinned verifier before the first model request.
- Advance an epoch fence after every edit, terminate stale work, and make old results unservable.
- Keep speculative output in pull-only quarantine until the model explicitly requests it.
- Preserve byte identity between a served result and the terminal result it replaces.

Offline prediction quality remains 75.4 percent top 1 and top 3 recall on held-out trajectories.

## Quickstart

Use an authenticated Codex CLI, then run Spex against a repository:

```sh
cd speculator
node src/main.mjs /path/to/repository "Fix the issue and verify the change"
```

## Reproduce the evidence

These commands test the implementation and recompute the committed measurements. They do not rerun the live benchmark.

```sh
cd speculator
node --test
node scripts/analyze-harder-bench.mjs
cd ..
python3 mining/eval.py
```

The paired rows are in `speculator/bench-results.jsonl`. The 84 event traces are in `speculator/bench-runs/harder-sealed-r1/`.

## How Codex built this

Development followed the repository specifications one at a time, with each acceptance gate completed before the next change. Codex implemented the daemon, tests, benchmark orchestration, sandboxing, and trace analysis. The human set the product priorities, contamination controls, benchmark policy, claims, and stop gates.

## Repository map

| Path | Purpose |
| --- | --- |
| `speculator/` | Daemon, tests, benchmark harness, analyzer, and raw trace evidence |
| `mining/` and `data/` | Prediction mining, held-out evaluation, and predictor tables |
| `blog/` | Product and benchmark presentation |
| `documentation/` | Architecture, benchmark, dashboard, and implementation notes |
| `schemas/` | Generated app-server protocol bindings |
