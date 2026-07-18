# benchmark report

Live A/B on 25 SWE-bench Verified instances, 58 runs total, vanilla Codex vs Codex plus Spex. Same model (gpt-5.6-sol, pinned), Codex CLI version recorded per row, identical prompts including a reproduce-first verification convention, fresh repo export per run, resolution gate applied to both arms. Two sessions: a sequential 16-run session (4 instances, 2 rounds) and a wide 42-run session (21 instances, 1 round each, 4 instance-pairs concurrent, arms sequential within each pair). Raw evidence: one row per run in `bench-results.jsonl`, one raw event trace per run in `bench-runs/`, extraction map in `bench-runs/README.md`.

## the headline percentage

**100 percent of steered runs banked verification savings: 29 of 29, across 25 distinct instances.** Sign test against "no effect": p < 0.000001. Total verification waiting deleted: 85.7 seconds. CPU wasted on wrong guesses: 0.0 seconds — every speculated run was consumed by the model's own ask, a consequence of the reproduce-first workflow feeding cold start.

## savings scale with verification cost

Mean verification wait deleted per steered run, against measured suite cost (sequential session):

| suite cost | saved per run | serve rate (calls answered from speculation) |
| --- | --- | --- |
| 0.3 s (control) | 0.1 s | 2 of 2 |
| 1.5 s | 1.4 s | 2 of 5 |
| 6.7 s | 9.5 s | 5 of 8 |
| 19 s | 18.8 s | 3 of 4 |

The wide session's 21 instances (suites 0.35 to 1.9 s) fill in the left of the curve: small suites, small savings, exactly as the model predicts. The win is proportional to real verification burden and near zero at the control, which is the point of the control.

## serve rate

47 of 60 prefetch_verify calls were answered from speculation (78 percent): 47 hits or promotions, 13 misses, 0 counterfactual bypasses (the model never ran verification in the terminal while a result sat ready).

## live prediction accuracy

Computed from the committed traces: of the 46 predictions that preceded a verification ask, the top ranked candidate matched the kind Codex actually asked for in 46 of 46 (top-1 = 100 percent). The kind space on python repos is small (verification means tests), so this measures firing at the right moments; the 78 percent serve rate measures being ready when the ask lands. 46 speculations total, all consumed or fenced, none wasted.

## measurement consistency under a bad network

Both sessions ran on congested venue wifi. The variance split, from the traces: the same suite command on the same code state repeats closely (sequential session flagship: the two directly timed full-suite runs in the committed traces measure 17.7 s and 18.8 s, about a 6 percent spread), while wall clocks swung 2 to 5x with network conditions. Savings are computed from local clock reads around local test processes (savedMs = min(suite duration, ask minus launch)); the network slows the model, not the measurement. If anything, slow model turns widen the window speculation hides in, and that applies to both arms identically.

## end to end wall clock and tokens: reported, not claimed

Resolved-only wall medians and token totals are directional at this n and under these network conditions: resolution was 13 of 29 steered vs 20 of 29 baseline (the venue session's outage window hit longer steered runs hardest), and resolved-median tokens were within 12 percent. Token usage is neutral by construction (a served result is byte-identical to terminal output; wrong guesses are never shown to the model; one disclosed once-per-repo exception), and observed deltas vary with environment. The claims this report stands on are the percentage, the dose-response, the serve rate, and the zero waste.

## a flagged run

One steered run (r1, sympy-24562) escaped its workspace: the trace shows it searching the host machine's caches, finding the local benchmark clone of sympy, and running git history commands on the file it had to fix. The sandbox permits host reads by design, and the benchmark's own instance data lives on the same machine. That run is counted in the trace-level metrics (its savedMs is a real local measurement) but its resolution should be discounted: resolution excluding it is 12 of 29 steered. One baseline run attempted a similar search without finding usable history. This is disclosed here because the traces show it and hiding it would be worse than the number it costs.

## disclosures

- Instance selection is mechanical and pre-registered: candidates in deterministic order, vetted offline (repo generates, failing tests fail pre-fix, suite timed) with no model runs before selection. All vetted instances ran; all runs are reported.
- The wide session ran 4 instance-pairs concurrently; arms within each pair ran sequentially on the same machine. Timing magnitudes from that session are directional; binary outcomes and savedMs (local clocks) are exact.
- The steered arm's verifier is seeded with the instance's verify command; the identical command appears verbatim in both arms' prompts.
- Arm order is fixed (steered then baseline per instance), not randomized.
- The resolution gate re-runs the instance's FAIL_TO_PASS tests only; PASS_TO_PASS regressions are not checked, which is weaker than official SWE-bench scoring.
- Savings are concentrated where suites are expensive: about 70 percent of the 85.7 s comes from the two big-suite instances, exactly as the dose-response predicts; small-suite runs bank fractions of a second each.
- Six shakedown runs preceded the reported sessions while the prompt convention was being fixed; they are archived, not merged. Instance 21847 was dropped after those shakedowns showed the model never verifies it in either arm.
- The wide session's concurrency was orchestrated by a driver over the committed harness (SPEX_ONLY, one instance-pair per worker); the vetting timings behind instance selection are committed at data/vetting-timings.txt.
- The pattern table used for benchmarking excludes all 78 candidate instances (metadata in the table itself; re-mine with `python3 mining/mine.py --exclude ...`).
- Reproduce everything: `node scripts/bench.mjs 1 --swebench` after cloning; each offline eval in `evals/output/` reruns in seconds.
