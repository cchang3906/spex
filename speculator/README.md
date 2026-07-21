# Spex

Speculative execution for coding agents. Tool calls run while the model is still thinking, and the answers are waiting when it asks.

Spex runs `codex app-server` behind a multi-session daemon. It watches parent and subagent events, predicts likely verification, and shares completed work through one cache. Remove the daemon and the underlying Codex workflow is unchanged.

## Requirements

Node 20 or newer, an installed and authenticated Codex CLI, and Python for benchmark repository setup and the offline evaluation.

## Quickstart

```sh
node src/main.mjs /path/to/repository "Fix the issue and verify the change"
```

## Sealed benchmark

The committed harder dataset contains 42 paired SWE-bench instances from 7 repositories. Its 84 sealed runs are larger and harder than the old 25-instance set. [The generated report](evals/harder-sealed-report.md) recomputes every result from the traces.

| Measure | Spex | Baseline | Result |
| --- | ---: | ---: | ---: |
| Runs | 42 | 42 | 84 total |
| Trace wall | 2,338,733 ms | 2,715,988 ms | 13.9% less |
| Verification calls | 110 | 67 | 64% more with Spex |
| Resolved | 38/42 | 38/42 | identical |

Spex served 88 of 110 verification requests, an 80% serve rate. Those hits hid 44,592 ms of verifier time. Savings scale with vetted suite cost, up to 6.6 seconds of `savedMs` per agent call. The agent verified 64% more and still finished faster because completed verification is nearly free when served.

Resolution was identical at 38/42 in both arms, so the measured speedup is lossless. Every run was sealed, 84/84, with 0 workspace escapes and 0 flagged forbidden-path attempts.

The 80% serve rate uses the intended integration convention: the repository pins the exact verifier used by the seed, cold start, and model request. Serve rate is lower without that command match.

## Correctness boundaries

- Prediction admits only allow-listed verification commands.
- The shadow queue has a speculative budget of 2.
- Cold start launches the pinned verifier before the first request.
- Every edit advances an epoch fence and makes stale results unservable.
- Pull-only quarantine keeps unrequested output out of the transcript.
- Served output is byte-identical to the terminal result.
- One daemon shares the cache across the parent session and its subagents.

Offline prediction quality remains 75.4 percent top 1 and top 3 recall on held-out trajectories.

## Reproduce the evidence

```sh
node --test
node scripts/analyze-harder-bench.mjs
cd ..
python3 mining/eval.py
```

The analyzer reads `bench-results.jsonl` and all 84 traces in `bench-runs/harder-sealed-r1/`. It checks paired arms, wall timing, verification counts, serve accounting, resolution, both seal layers, and outside-workspace command attempts. It regenerates `evals/harder-sealed-report.md` only when every invariant passes.

## How Codex built this

Development followed the repository specifications one at a time, with each acceptance gate completed before the next change. Codex implemented the daemon, tests, benchmark harness, sandbox, and trace analyzer. The human directed product priorities, contamination controls, benchmark policy, claims, and stop gates.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | Transport, routing, prediction, scheduling, cache, serving, sandbox integration, and CLI |
| `test/` | Protocol, scheduler, cache, daemon, sandbox, and integration coverage |
| `scripts/` | Sealed benchmark runner and trace analyzer |
| `data/` | Vetted SWE-bench instances and predictor inputs |
| `bench-results.jsonl` | Paired result rows |
| `bench-runs/harder-sealed-r1/` | Raw event traces for the harder sealed benchmark |
| `evals/harder-sealed-report.md` | Generated benchmark report |
