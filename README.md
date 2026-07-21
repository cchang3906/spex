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

Spex mined thousands of agent trajectories from SWEBench and OpenHands using PrefixSpan and created a transition-probability matrix for tool chains. Indexing into this table, Spex instantly loads the most likely tool type based on the previous tool calls, and the most likely path variation for its argument. The client then runs likely commands in a shadow queue with a budget of 2 slots and caches the output upon completion. If a speculation hits while running, the running process is dynamically promoted to the main queue. Agents are instructed to use our custom dynamic tool for testing, linting, and typechecking. Upon calling the tool, the cached results are instantly returned to Codex, cutting verification latency.

## reproduce

From the repo root:

```
cd speculator && env -u NODE_OPTIONS node --test                unit tests (51)
env -u NODE_OPTIONS python3 mining/eval.py                      offline recall, held out trajectories
env -u NODE_OPTIONS python3 mining/eval_spike.py                recall on out of distribution codex sessions
env -u NODE_OPTIONS node speculator/scripts/bench.mjs 1 --swebench   live a/b on swe bench verified
```

Requires Node 20+, python3, and for the live benchmark the `codex` CLI
authenticated with access to the pinned model. Raw evidence from the reported
runs is committed: one row per run in `speculator/bench-results.jsonl`, one
event trace per run in `speculator/bench-runs/`.

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
