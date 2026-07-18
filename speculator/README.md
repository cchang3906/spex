# spex

It runs your tools before you ask.

Spex is a speculative tool execution daemon for OpenAI Codex. It launches `codex app-server` as a child process, watches every event over JSON RPC, and when Codex edits a file it predicts the verification that usually comes next, tests, lint, typecheck, and runs it in Codex's own sandbox while the model is still generating. When Codex asks, the answer is often already there. Codex itself is never modified, forked, or patched: remove the daemon and Codex is exactly Codex.

Wrong guesses cost laptop CPU, never correctness and never tokens: speculative results are quarantined until Codex explicitly asks, every file edit fences the cache, and only allow-listed verification commands are ever admitted.

## requirements

Node 20 or newer, the `codex` CLI installed and authenticated, access to the pinned model, and python3.11 for benchmark repo generation.

## quickstart

```
node src/main.mjs <repo> "<task>"          codex through spex
SPEX_DASH=1 node src/main.mjs <repo>  same, plus live dashboard at :7777
node --test                                51 unit tests
```

## the claim, and the proof

Our claim: same model, same prompts, the verification wait deleted.

- Live A/B benchmark on [SWE-bench Verified](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified) instances (four chosen by measured verification cost: a 0.3 s control plus 1.5 s, 6.7 s, and 19 s suites, so savings can be shown to scale with suite cost and to vanish when there is nothing to hide), vanilla Codex vs Codex plus Spex: `node scripts/bench.mjs 1 --swebench`. Results land in `bench-results.jsonl` (generated at the live run), raw event traces in `bench-runs/` with an extraction map in `bench-runs/README.md`. Steered runs get the repo's verify command seeded into the learned verifier tier; the baseline prompt states the identical command verbatim, so neither arm has to discover it.
- Offline prediction quality, reproducible by command: top 1 and top 3 recall 75.4 percent on held out trajectories (`python3 mining/eval.py`), top 2 recall 82 percent and post edit recall 100 percent on real out of distribution Codex sessions (`python3 mining/eval_spike.py`).
- Full protocol, axes, and disclosed non-claims: `docs/benchmark.md`.

## repo map

See `DESIGN.md` for the full layout: the daemon in `src/`, the mining pipeline and offline evals in `mining/` and `evals/`, the benchmark harness in `scripts/`, and the trace evidence in `bench-runs/`.

## build timeline, honestly

Built before the event: the daemon and its unit tests, the mining pipeline and pattern table, the offline eval suite, the benchmark harness and instance selection, the CLI and dashboard renderers, and the design docs in `documentation/`.

Built during the event: the wide benchmark session (25 instances, 58 runs), the offline resilience layer (clone cache, wheelhouse), the live percentage and top-1 accuracy analyses, the blog's evidence fill, the benchmark report, and the adversarial review fixes it demanded.
