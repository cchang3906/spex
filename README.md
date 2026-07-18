# spex

A speculative execution layer for a coding agent's tool calls.

Spex wraps OpenAI Codex, unmodified. It watches the session over the public
`codex app-server` protocol, and when the model edits a file it predicts the
verification that usually comes next (tests, lint, typecheck) and pre-runs it
in Codex's own sandbox while the model is still generating. The moment Codex
asks, the cached result is served in milliseconds. Wrong guesses cost laptop
CPU only, are never shown to the model, and every file edit fences stale
results so nothing out of date can ever serve.

The claim: gpt-5.6-sol, minus the waiting. Same model, same prompts, the
verification wait deleted.

## measured results

Live A/B on 25 SWE-bench Verified instances, 58 runs, vanilla Codex vs Codex
plus Spex. Full report with methodology and disclosures:
`speculator/evals/report.md`.

| metric | result | meaning |
| --- | --- | --- |
| runs that banked savings | 29 of 29 (100 percent) | every steered run deleted some verification waiting; sign test p < 0.000001 |
| total verification waiting | 121 s vanilla vs 76 s spex (37 percent less) | time the model sat blocked on test results, summed across all 58 runs |
| serve rate | 47 of 60 (78 percent) | verification calls answered from speculation instead of run on demand |
| live top-1 prediction | 46 of 46 (100 percent) | every prediction preceding an ask named the kind Codex actually asked for |
| wasted CPU | 0.0 s | every speculated run was consumed by the model's own ask; nothing thrown away |
| tokens | neutral by construction | served output is byte identical to terminal output; observed deltas vary by environment |
| end to end wall clock | directional, not claimed | small n on congested venue wifi; see the report |

Savings scale with what verification costs. Mean waiting deleted per run,
against the measured suite cost of each instance:

| suite cost | saved per run |
| --- | --- |
| 0.3 s (control) | 0.1 s |
| 1.5 s | 1.4 s |
| 6.7 s | 9.5 s |
| 19 s | 18.8 s |

How to read this: the win is proportional to how expensive your tests are.
On the deliberately cheap control there is nothing to hide, so almost nothing
is saved, which is the point of the control: it shows the effect is real
verification burden being moved off the clock, not an artifact of the
harness. Saved can exceed one suite cost when a run serves more than one
verification. Every number above is recomputed from the committed raw traces
by the extraction map in `speculator/bench-runs/README.md`, and a cold clone
reproduction audit verified them independently.

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
