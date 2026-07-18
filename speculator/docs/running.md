# running mentalist

## commands

```
node src/main.mjs <repo> "<task>"            codex through mentalist
MENTALIST_DASH=1 node src/main.mjs <repo>    same, plus live dashboard at localhost:7777
MENTALIST_BASELINE=1 node src/main.mjs ...   speculation off, for a/b comparison
node src/cli.mjs <repo>                      interactive cli renderer
node --test                                  unit tests
node scripts/bench.mjs <rounds> --swebench   the a/b benchmark
node scripts/format-trace.mjs                raw traces to readable timelines
```

Activation is literally swapping the launch command. A repo opts in with one AGENTS.md steering file routing verification through the `prefetch_verify` tool. Plain `codex` remains untouched.

## the steering file

A repo opts in by dropping this AGENTS.md at its root (the demo and benchmark generators write it automatically):

```
## Verification
This workspace provides a `prefetch_verify` tool. Whenever you need to run tests, lint,
typechecking, or a build to verify your changes, ALWAYS call `prefetch_verify` with the
appropriate kind instead of running those commands in the terminal. Call `prefetch_verify`
with kind "test" to reproduce the failure and again after every change you make. It executes
the exact same command in the same sandbox and returns the exit code and output, usually
much faster, because the result may already be prepared. For all other commands, use the
terminal normally.
```

Remove the file and the daemon still works; the model just routes fewer verifications through the tool.

## environment variables

- `MENTALIST_BASELINE=1` speculation off, tool not registered, codex is exactly codex
- `MENTALIST_DASH=1` serve the live dashboard
- `MENTALIST_MODEL` pin the model (the benchmark pins gpt-5.6-sol)
- `MENTALIST_TABLE` path to an alternate pattern table (the benchmark uses the bench clean table)
- `MENTALIST_OFF=1` same effect as baseline for the scheduler

## event glossary

Every run writes one jsonl event stream (`.prefetch/events.jsonl`), the single source of truth for the cli, the dashboard, and the benchmark.

| event | meaning |
| --- | --- |
| predict | the table proposed what comes next, with probability |
| abstain | a proposal failed an admission gate, named in `door` |
| admit | all four gates passed |
| speculate | a command launched early |
| serve, hit | a finished fresh result answered in milliseconds |
| serve, promoted | the request joined a run already in flight and banked its head start |
| serve, miss | nothing was ready, ran normally |
| outcome | a speculative run settled: reused, discarded, or preempted, with savedMs and wastedMs |
| reset | a file change fenced the cache, epoch bumped |
| counterfactual | a result was ready but codex ran the command in the terminal anyway |
| tokens | codex's own cumulative usage |
| serve, unknown | no verifier known yet for this repo, the once per repo teaching reply |
| mode | which mode this run is, baseline or on |
| warn | a non fatal protocol surprise, logged and skipped |
| codex | codex activity: exec, done, edit, status |

## benchmark report columns

| column | meaning |
| --- | --- |
| wallMs | spawn to turn completed |
| resolved | the failing tests were re run afterwards and pass, fast failures are not wins |
| verifyStallMs | time the model was blocked waiting on verification |
| toolWaitP50, toolWaitP95 | typical and tail wait per verification call, pooled |
| hits, misses | served from speculation vs ran on demand |
| savedMs | waiting deleted, min(duration, ask minus launch) |
| wastedMs | cpu burned on wrong guesses |
| tokens | expected flat between modes |
| speculations | speculative runs launched |
| failed | the run process died or timed out, excluded from every aggregate |
| codexVersion | recorded per run, not assumed |
