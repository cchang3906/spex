# a/b benchmark plan · eval axes

the report evaluates on the axes below, measures what a single session laptop deployment can, and marks the rest not applicable with a reason. never claim an axis we did not measure.

## instances

swe bench verified, fresh history export per run (test patch applied, code patch withheld, steering text only in on mode, never in baseline history). per instance verification convention stated identically in both modes prompts.

| instance | verify command | measured cost |
|---|---|---|
| pytest 10051 | pytest test_fixture.py | 0.3s, the control: we should save ~nothing |
| sympy 21596 | pytest test_fancysets.py | 1.5s |
| sympy 21930 | pytest test_secondquant.py | 6.7s |
| sympy 21379 | pytest -q sympy/core/tests | 19s |
| sympy 21847, flask 5014, pytest 10081 | staged in the dataset, no verify command wired | 21847 dropped: the model never verifies it in either arm, pure noise |

verification cost is the independent variable: the claim is the win scales with tool time (the paper's tool heavy vs llm dominated finding, section 7.3 robustness note).

## evaluation intro (report text, our equivalent of the paper's 7.0)

this section evaluates mentalist along six axes: (1) end to end latency improvement on real swe bench verified tasks, (2) verification wait reduction, the tool side latency the system exists to hide, (3) where the improvement comes from, a time breakdown attributing every second to model thinking, tool execution, tool stall, or overlap, (4) prediction quality, both offline on held out trajectories and live during the runs, (5) speculation overhead and safety under mispredictions, reported as cpu seconds spent per second of wait hidden and as an audit of admitted actions, and (6) token cost, since speculation must not buy speed with tokens. two of the paper's axes are deliberately absent: scalability under concurrent sessions does not apply to a single session laptop deployment, and there is no llm side scheduler to ablate because our tools and our model cannot contend for the same hardware. across all experiments we hold the model, the codex version, the machine, the task prompts including the verification convention, and the per run repo generation constant to isolate the system effect; both modes run sequentially on freshly generated repositories whose git history never contains the fix; the steered arm's single initial commit carries AGENTS.md, which is the documented intervention itself, and the baseline arm's history carries no steering at all, and the pattern table used for benchmarking is re mined with the benchmark instances excluded from the mining corpus, so there is no train test overlap.

## time attribution definitions 
- tool execution: active runtime of verification commands
- tool stall: time codex is blocked waiting for a verification result (baseline: full duration; on: duration minus savedMs)
- overlap: speculative execution running while the model is generating (savedMs for served runs; full runtime for wasted runs)
- speculation overhead: predictor lookup (~100ns) plus daemon bookkeeping, negligible and stated
- the report's centerpiece: one stacked bar per mode per instance from these buckets, our figure 13

## metric coverage
- e2e latency: wall clock per run, spawn to turn completed, medians per mode with per instance rows; medians pool resolved runs only, the report gates on the resolution field
- observed tool execution latency: waitMs on every serve event, entry to response of each prefetch_verify call; hits land in milliseconds, promotions in remaining runtime, misses in full runtime
- tail latency: p50 and p95 over per call tool waits pooled across runs; run level p99 is not reported, n is too small to be honest at that quantile
- tool stall time: verifyStallMs from our own exec to done timestamps in baseline, waitMs sum in steered mode; the two are the same quantity seen from each mode's side
- llm side queueing: not measurable here, the model is hosted at openai and we never see its queue; disclosed as n/a
- throughput: not applicable, one agent on one laptop, not a serving system; disclosed as n/a
- speculative hit rate: hits over speculations (precision) and hits over verification asks (coverage), plus the offline recall numbers
- resource overhead: wasted cpu seconds of discarded and preempted runs, bounded by the two slot budget; token overhead tracked separately and expected flat

## axes

1. e2e latency 
   ours: wall clock per run, spawn to turn completed. medians per mode per instance, spread shown. runs that do not resolve the issue are reported but excluded from timing medians (a fast failure is not a win). resolution checked by us rerunning fail to pass after the run, deep swe style, not trusting the agent.

2. tool side latency 
   ours: savedMs per verification from real timestamps; per verify wait with vs without. tool throughput under bursty arrivals is not applicable (single session); stated.

   hit rate definition, per tool call: the probability that any speculatively executed prediction matches the call codex actually makes. ours = served (reused plus promoted) over asks. reported next to top k prediction accuracy because the two diverge by design: multiple candidates under a budget make hit rate the product number even when top 1 is modest.

3. time breakdown 
   ours: from events, wall time split into model time vs tool wait vs hidden. one stacked bar per mode per instance.

4. scalability under concurrency 
   not applicable: single session laptop deployment. said plainly.

5. ablation of tool side vs llm side scheduling (paper 7.x)
   not applicable: we have no llm side component by design (see implementation doc). the on/off a/b is our only ablation.

6. prediction quality 
   ours, already measured offline: top3 75.4 held out, top2 82 ood on real codex sessions, 100 percent post edit. live: hit rate = served / asks from the a/b runs. report both, note the known lesson that hit rate is the product number and top1 is not. disclose the label skew plainly: on our validation split every allow listed next class is TEST, so a constant always test predictor would score 100 on recall; the table's measured value is knowing WHEN to fire, 75.4 percent of eligible contexts produce a confident prediction and the rest abstain, which is coverage and gating quality, not multi class discrimination. the spike sessions also ran under mentalist steering, so post edit recall there partially measures convention adherence.

7. side effect evaluation 
   ours: (a) by construction: allow list admits only verification commands; audit the event log for zero admitted non verification speculations. (b) result parity: fail to pass flip status equal across modes per instance. (c) quarantine: no push channel exists; state the design guarantee.

8. resource overhead 
   ours, from events: cpu seconds of speculative execution (useful plus wasted run durations) per second of wait hidden. plus predictor lookup cost (~100ns, hash map). plus tokens: measured per run per mode, expected delta ~0 (the zero token overhead claim).

## the mapper for these instances (disclosed)

the bench clean table is regenerated from the committed miner: python3 mining/mine.py --exclude <comma separated instance ids from data/swebench-instances.json>. the table records the excluded ids and trajectory count in its own metadata.

the verification convention is stated identically in both modes prompts. in on mode the same command is also seeded into the daemon's verifier store at repo generation, exactly as a repo would carry it in config (a makefile test target equivalent). without the seed, static detection would resolve TEST to bare pytest and speculate the entire suite on the first edit; with it, the first speculation runs the intended command. tier 2 learning then keeps it aligned with whatever codex actually runs.

## protocol

- shakedown: 1 round x 3 sympy instances x 2 modes (6 runs). inspect traces, fix prompt or convention issues.
- official: 2 to 3 rounds, same protocol, numbers frozen, rerun at the venue for the readme if time allows.
- every run appends one json line to bench-results.jsonl; the report and the comparison visuals read only that file.
- honesty rules: small n disclosed, spread shown next to medians, control instances reported (we save nothing when there is nothing to hide), non resolving runs disclosed.

## report skeleton (ramp swe bench structure)

overview · instances (receive / do not receive table) · harness · scoring · results by axis · threats to validity · future work (rewind protocol via thread/fork, concurrency, more instances)
