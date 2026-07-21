# Spex

**Codex gets verification results before it knows it needs them.**

## Problem

Coding agents run a serial loop: think, call a tool, wait, read the result, think again. Verification—tests, lint, type-checking, and builds—sits directly on that critical path. After a code edit, the next verification is often predictable, but the agent still waits for it from scratch.

That leaves useful compute on the table. While Codex reasons about the next step, the repository is idle even when the likely verification command is already known.

## Solution

Spex brings CPU-style branch prediction to coding-agent tools. It watches Codex through the app-server event stream, uses the session trajectory to predict the next safe verification action, and starts that work while Codex is still reasoning.

At session start, Spex pre-runs the repository's test verifier. After a file edit, a mined pattern table predicts test, lint, type-check, or build. Spex resolves the exact repository command, launches it in a two-slot background shadow queue, and caches the result under the current source epoch. Codex reaches that work through one tool, `prefetch_verify`:

- **Finished** → return the cached result.
- **Still running** → promote the same process and wait only for the remainder.
- **No match** → run the repository's verifier normally, on demand.

The cache is pull-only: Spex never injects an unrequested result into the conversation. Every edit advances the source epoch, making older results ineligible to serve against newer code. A wrong prediction is isolated and discarded without entering the model's context.

We mined **2,146 real coding-agent trajectories and 90,591 normalized events** from SWE-bench and OpenHands. A PrefixSpan-style pipeline turned recurring tool sequences into a transition-probability table. Runtime prediction is a map lookup over recent tool signatures, so it adds no second model call or inference-token cost.

We separated predicting the next *kind* of action from resolving its exact command. The predictor selects a class such as test or lint; a repository-aware resolver supplies the real command from project configuration, conventions, or a command already observed in that repository. Commands are grounded in the codebase rather than generated as probabilistic arguments.

Speculative work launches only when the command resolves, its class is allow-listed, prediction confidence clears the threshold, and a slot is available. The scheduler suppresses duplicates and keys work by command, working directory, and source epoch. Append-only traces record predictions, launches, cache hits, promotions, misses, resets, and timing measurements.

We built Spex with Codex one written specification at a time, with an acceptance gate before moving to the next subsystem. Codex implemented the app-server transport, resolver, mining pipeline, predictor, scheduler, cache, serve path, dynamic tool, subagent support, tests, benchmark harness, and analyzer. The team made the product and evaluation decisions: contamination policy, command pinning, benchmark selection, which claims to retain, and when to stop building.

## Evaluation

We ran a sealed, paired A/B evaluation on **42 SWE-bench Verified instances across seven repositories, producing 84 trace-backed runs**. Both arms received the same problem, repository verifier, pinned model, and fresh repository export.

Each benchmark cell ran without Git history inside a filesystem seal that blocked the clone cache, benchmark metadata, and reference patches. All 84 cells carried both sandbox receipts, and the analyzer detected **zero workspace escapes**.

- **Identical resolution:** Spex and baseline each solved 38 of 42 instances.
- **80 percent serve rate:** 88 of 110 Spex verification calls were answered from completed or in-flight speculation.
- **13.9 percent less aggregate trace wall time:** 2,339 seconds for Spex versus 2,716 seconds for baseline in this sample.
- **64 percent more verification:** the Spex arm checked its work 110 times versus 67 for baseline.
- **44.6 seconds of measured verification head start:** up to 3.2 seconds on one verification call and 6.7 seconds across one agent run.

Offline evaluation measured 75.4 percent held-out recall. A separate out-of-distribution Codex sample reached 82 percent top-two recall and matched all 22 post-edit verification events.

We report trace wall, resolution, serve rate, and measured overlap separately. The 13.9 percent trace-wall result is an observed benchmark difference, not a claim that every second came directly from speculation. Every published number can be recomputed from the committed traces without model access.

## Challenges and limitations

- **Benchmark contamination.** Our first benchmark used fresh temporary repositories, but one run still reached a cached host clone and read its Git history. A clean working directory was not an isolation boundary. We rebuilt the harness around per-cell filesystem seals, stripped repository history, blocked cache and benchmark paths, emitted receipts, and scanned every command for paths outside the workspace.
- **Measuring real savings.** A cache hit is not automatically equal to end-to-end time saved. Spex measures how much verifier execution overlaps model work and reports that head start separately from total wall time.
- **Small verifiers hide little latency.** A correct prediction on a 300-millisecond test has almost nothing to hide. Mean hidden time per run increased from 418 milliseconds in the cheapest suite group to 2,202 milliseconds in the most expensive group.
- **Live runs are nondeterministic.** Model behavior, network conditions, and machine load can change exact timings. We make the committed evidence and metric extraction reproducible rather than claiming identical live reruns.
- **The current scope is verification.** Spex does not yet speculate on source edits, arbitrary shell commands, external API calls, or model calls.
- **The current live environment is macOS-focused.** Broader platform and project-type coverage still needs evaluation.

## Accomplishments

- Built speculative execution without adding a second LLM to the runtime prediction path.
- Served 80 percent of Spex verification calls from speculative work while matching baseline resolution in the benchmark.
- Made stale results structurally ineligible through source-epoch fencing.
- Kept wrong predictions out of Codex's transcript with a pull-only tool boundary.
- Rebuilt the benchmark after discovering contamination instead of hiding the invalid evidence.
- Committed the raw traces and analyzer needed to audit every published number.
- Demonstrated that cheaper verification changed agent behavior: Spex verified 64 percent more often while recording less aggregate trace wall time in this sample.

## Next steps

- Support more project types and operating systems.
- Evaluate larger and more diverse benchmark suites.
- Explore other reversible tool calls with branch-specific isolation and explicit rollback rules.
- Turn the prototype live dashboard into a full trace explorer for real queues, shadow queues, hits, promotions, misses, and saved time across complete sessions.

## Stack

Codex and Codex app-server, Node.js, Python, JSON-RPC, JSONL event traces, SWE-bench Verified, OpenHands and SWE-agent trajectories, and PrefixSpan-style sequential-pattern mining.
