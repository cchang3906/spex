# offline eval results


Captured outputs live in `evals/output/`, one file per eval, regenerated any time by rerunning the command that produced it. Each eval runs in seconds from a clean clone, so every number below can be reproduced live.

every number here was produced before the runtime ever touched a live codex session or a demo repo. four layers, each one command to reproduce. run from repo root.

## layer 1: fixtures (unit)

`node --test`

51 tests, 0 fail. includes: all 90 real command strings from `data/fixtures_argv.json` classify to their expected kind, the 8 cache state machine asserts, 5 scheduler admission scenarios, serve and listener paths, router dispatch.

## layer 2: property fuzz

`node evals/invariants.mjs` (seed 20260717, reproducible)

10000 random event sequences through the real scheduler and cache: 35755 speculative launches, every outcome settled exactly once, only the four allowed outcomes, max concurrency observed 2 (budget respected at every instant), 0 stale epoch serves, 0 unhandled rejections. PASS.

## layer 3: held out trajectory simulation

`node evals/simulate.mjs`

350 held out trajectories (validation split, never mined) replayed through the real predictor, scheduler and cache. assumptions printed in the output header: nominal 7000 ms verification duration, virtual clock 3000 ms per event, argv resolution faked (this eval measures prediction and scheduling, not verifier discovery).

- 2767 verification asks total
- would be hit rate 39.9 percent (69 reused plus 1035 promoted)
- trigger coverage 76.4 percent of verification asks had a speculation launched since the last edit
- 5.33 speculations per trajectory, 760 wasted (launched, never asked before the next epoch bump)
- abstains: 1175 by the confidence door, 0 by executable, policy or budget doors
- per scaffold hit rate: sweagent 49.5, openhands 41.8, mini-swe-agent 12.3

reading: most hits arrive as promotions, the ask lands while the suite is still running, which still hides the head start. mini-swe-agent drags the average because its trajectories verify in patterns the table rarely covers. the number the product actually ships on is the codex specific one below.

## layer 4: real codex sessions (replay)

`node test/replay.mjs documentation/spike/samples/phaseB.jsonl`

the 21 recorded compliance sessions replayed through the actual router, as if live:

- outcomes: reused 21, promoted 0, discarded 0, preempted 0
- serves: hit 21, miss 8, unknown 0
- abstains: 1 (confidence)
- sessions 21, uncaught exceptions 0

reading: on real codex behavior the post edit verification pattern is strong enough that every completed speculation got asked for. savedMs totals in replay are not meaningful (fake executor durations); timing claims come from the live A/B only.

## cross language normalizer agreement

`node evals/agreement.mjs`

11940 labeled events: 75.02 percent agreement between the js classifier and the python miner labels. the disagreements are concentrated and explained:

- scaffold pseudo commands (str_replace_editor view, scroll_down): python calls them READ, js calls them OTHER. irrelevant at runtime, codex never emits these, they exist only in mined scaffolds
- `python final_test.py` style script runs: python says RUN, js says TEST. this is the one real seam; it makes the runtime slightly more willing to treat script runs as verification than the miner was. tracked, acceptable

## honest gaps

- no wall clock timing claim yet: that requires the live A/B on demo repos (baseline with no tool and no AGENTS.md, steering text never in git history)
- simulation durations are assumptions, labeled as such
- verifier discovery (tier 1 config detection) is unit tested but not exercised by the simulation, which fakes resolve
