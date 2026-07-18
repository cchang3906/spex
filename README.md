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

Add up every second across all 58 runs and the picture is simple:

| | vanilla codex | spex codex | delta |
| --- | --- | --- | --- |
| total wall time (29 runs each arm) | 3,617 s | 3,047 s | 15.8 percent less |
| time blocked waiting on verification | 121 s | 76 s | 37 percent less |
| head starts banked by speculation | none | 85.7 s | |
| CPU wasted on wrong guesses | none | 0.0 s | nothing thrown away |

The number to remember is 37 percent: the model spent about a third less of
its life frozen waiting for test results, and it happened in 100 percent of
steered runs (29 of 29, sign test p < 0.000001). The 15.8 percent wall clock
figure carries a caveat stated plainly in the report: the arms resolved
unevenly under venue network conditions, so treat it as directional. The
verification waiting row has no such caveat; it is measured by local clocks
around local test processes and the network cannot touch it.

Where does the saving come from? It scales with what your tests cost:

| suite cost | waiting deleted per run |
| --- | --- |
| 0.3 s (control) | 0.1 s |
| 1.5 s | 1.4 s |
| 6.7 s | 9.5 s |
| 19 s | 18.8 s |

On a 19 second suite, spex deletes essentially the whole suite from the
model's experience on every verification. On the deliberately cheap control
there is nothing to hide and almost nothing is saved, which is the point of
the control: the effect is real verification burden being moved off the
clock, not an artifact of the harness. And the machinery earns its keep
quietly: 78 percent of verification calls (47 of 60) were answered from
speculation, the top ranked prediction matched what Codex asked for in 46 of
46 cases, and tokens are neutral by construction because a served result is
byte identical to what the terminal would have printed.

Every number above recomputes from the committed raw traces via the
extraction map in `speculator/bench-runs/README.md`; a cold clone
reproduction audit verified them independently.

## a demo moment

<!-- gif goes here -->

During a live demo the environment had drifted: a package version collision
that would normally send the agent into several turns of dependency
debugging. Spex had already executed the suite in the real environment, so
the served output showed the actual failure state directly, and the model
skipped the whole multi turn loop of chasing the drift. Speculation does not
just hide the wait; because the result comes from a real run in the real
sandbox, it also short circuits the reasoning the model would spend
reconciling what it expects with what the environment actually is.

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
