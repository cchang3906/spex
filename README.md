## spex


A speculative execution layer for a coding agent's tool calls.

Codex uses a serial tool loop to code: think, call tool, read output, and think again. This sequential process is too slow, and forces Codex to wait for tool results. Our client predicts Codex's future tool calls based on its current trajectory, runs multiple speculative tools in parallel, and caches them so Codex instantly retrieves tool results upon request. Through Spex, Codex has access to tool outputs before it even knows it needs it.

## demo
<img width="3584" height="2240" alt="Spex Demo Video" src="https://github.com/user-attachments/assets/9407a262-f4cd-4ad6-8ae9-81863acf2ebf" />

## measured results

SWE-bench results, head to head against vanilla Codex (42 SWE-bench Verified
instances across 7 repositories, 84 sealed runs): 13.9 percent less trace wall
time at identical resolution. Full report with methodology and disclosures:
`speculator/evals/harder-sealed-report.md`.

Add up every second across all 84 sealed runs and the picture is simple:

| Measure            |         Spex |     Baseline |             Result |
|--------------------|--------------|--------------|--------------------|
| trace wall         | 2,338,733 ms | 2,715,988 ms |         13.9% less |
| verification calls |          110 |           67 | 64% more with Spex |
| resolved           |        38/42 |        38/42 |          identical |

Spex served 80% of verification calls, 88 of 110, and hid 44,592 ms of verifier time. The result is lossless because resolution is 38/42 in both arms.

Spex mined thousands of agent trajectories from SWEBench and OpenHands using PrefixSpan and created a transition-probability matrix for tool chains. Indexing into this table, Spex instantly loads the most likely tool type based on the previous tool calls. The verifier resolver supplies the exact command and arguments from repository conventions. The client then runs likely commands in a shadow queue with a budget of 2 slots and caches the output upon completion. If a speculation hits while running, the running process is dynamically promoted to the main queue. Agents are instructed to use our custom dynamic tool for testing, linting, and typechecking. Upon calling the tool, the cached results are instantly returned to Codex, cutting verification latency.

## Advantage

- Faster with zero downside. 13.9 percent less wall time at identical resolution, 38 of 42 solved in both arms. It is lossless: Spex removes the wait without changing what the agent solves.
- 80 percent of verification served instantly. 88 of 110 calls answered from speculation, before the model finished asking.
- Verification becomes free, so the agent checks more and still finishes faster. The steered agent verified 64 percent more often, 110 versus 67, and came out ahead on wall time.
- It scales with your pain. Savings track suite cost, up to 6.6 seconds hidden per call, projecting to minutes on real multi-minute CI suites.
- Safe by construction. Served output is byte identical to the terminal, wrong guesses are never shown to the model and cost only local compute, every edit fences stale results. Remove the daemon and Codex is exactly Codex.
- Every number is reproducible. An analyzer recomputes every claim from the committed traces, no live benchmark or model access required.

**Moat.** Prior speculative-agent work uses an LLM speculator that burns tokens and caps latency gains around 50 percent. Spex uses a zero-token table on the highest-value vertical, coding verification, and is the only one proven lossless on real bugs. It is not a faster model. It is the same model with the waiting removed.

## reproduce

From the repo root:

```
cd speculator && env -u NODE_OPTIONS node --test                unit tests (56)
env -u NODE_OPTIONS python3 mining/eval.py                      offline recall, held out trajectories
env -u NODE_OPTIONS python3 mining/eval_spike.py                recall on out of distribution codex sessions
env -u NODE_OPTIONS node speculator/scripts/bench.mjs 1 --swebench   live a/b on swe bench verified
```

Requires Node 20+, python3, and for the live benchmark the `codex` CLI
authenticated with access to the pinned model. Raw evidence from the reported
runs is committed: one row per run in `speculator/bench-results.jsonl`, one
event trace per run in `speculator/bench-runs/`.

## Try it

The ready-made demo instance is `pydata__xarray-6992`, a real SWE-bench bug with a clean pytest verification so the tool fires cleanly.

1. Generate the demo repository offline from the clone cache:

```
cd speculator && bash scripts/swebench-repo.sh pydata__xarray-6992 /tmp/spex-demo
```

2. Run the CLI on it:

```
node src/cli.mjs /tmp/spex-demo
```

3. Give it exactly this task and nothing more. Do not name a command, so the model routes verification through the tool:

```
Fix the failing tests in this repo and verify your fix.
```

Watch for the model to read the seeded `AGENTS.md` and call `prefetch_verify`. The CLI shows a cache-hit line as the pre-run verification is served during the model's own thinking. That is the tool firing.

To see the vanilla baseline instead, generate with `--baseline` for no `AGENTS.md` and no tool, then run plain `codex` in the repository.

The live demo requires an authenticated Codex CLI with access to the pinned model.

## Installation and testing for judges

Supported platforms: macOS with Node 20 or later. Python 3 is needed for the mining evaluation. An authenticated Codex CLI with access to the pinned model is needed only for the live tool and live benchmark.

Install by cloning the repository and entering `speculator`:

```
git clone https://github.com/cchang3906/spex.git
cd spex/speculator
```

Spex has zero runtime npm dependencies. That is the complete installation.

To test the tool live, run one of these commands and then give it a task:

```
node src/cli.mjs /path/to/repo
SPEX_BASELINE=1 node src/cli.mjs /path/to/repo
```

Judges can verify the published claims without rerunning the benchmark:

```
node --test
node scripts/analyze-harder-bench.mjs
```

The test command runs the suite. The analyzer recomputes every published number from the committed traces in `speculator/bench-runs/harder-sealed-r1/`. No live benchmark or model access is needed to check the numbers.

This repository is shared for judging. No credentials are required to read it or run the offline verification.

## How Codex built this

Spex was built spec by spec, with one Codex session for each written specification. Every spec ended with an acceptance gate that had to pass before work moved to the next one. The Codex-authored commits retain their dated history, and the [per-spec session log](docs/codex-sessions.md) records the `/feedback` session IDs.

Codex implemented the app-server transport that wraps Codex without modifying it, verifier resolution, the trajectory mining pipeline and pattern table, the predictor, the shadow-queue scheduler, the cache and serve path, the `prefetch_verify` tool, multi-session subagent support, the full test suite, the sealed benchmark harness, and the trace analyzer.

Codex accelerated the work by standing up each subsystem from a written spec in a single session and turning debugging around quickly. It diagnosed and fixed the sandbox seal that blocked the virtual environment interpreter, the command mismatch that tanked the serve rate, and the cache accounting.

The humans made the product and evaluation decisions. They set the product priorities, contamination controls and sealing policy, pinned verification command, benchmark instance selection, claims to keep or drop, and stop gates that prevented sessions from over-building.

GPT-5.6 had a dual role. It is the model Spex accelerates in the benchmark and the model that wrote the implementation through Codex.

## dashboard (prototype)

<img width="722" height="607" alt="Screenshot 2026-07-18 at 2 56 20 PM" src="https://github.com/user-attachments/assets/71a091db-8174-4091-839d-a7d233d6e75b" />


## repo map

- `speculator/` the daemon, its unit tests, the benchmark harness, the eval
  suite, and the raw evidence traces. Start with `speculator/README.md` and
  `speculator/DESIGN.md`.
- `blog/` the site presenting the system and the benchmark evidence.
- `mining/` + `data/` provenance of the prediction pattern table: the mining
  pipeline over 2146 real agent trajectories, the offline recall evals, and
  the tables and corpora they produce.
- `documentation/` team docs, including the CLI UI spec
  (`documentation/cli-ui-mvp.md`), the dashboard handoff, and the
  implementation plan.
- `schemas/` generated app-server protocol bindings (codex-cli 0.144.4).
