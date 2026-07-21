# traces

Every benchmark number in the report is extracted from the raw event logs in this directory. One file per run, named `r{round}-{instance}-{mode}.jsonl`, copied verbatim from the daemon's `.prefetch/events.jsonl` at the end of the run. Nothing is post processed before it lands here: these are the same lines the dashboard streamed live.

The 84 harder sealed A/B traces live in `harder-sealed-r1/`. Recompute their report and invariants with `node scripts/analyze-harder-bench.mjs`.

Readable versions live in `formatted/`, one markdown timeline per trace. Regenerate them any time with:

```
node scripts/format-trace.mjs
```

## event schema

Each line is one JSON object with a millisecond timestamp `t` and a `type`:

| type | fields | meaning |
| --- | --- | --- |
| mode | baseline | which mode this run is |
| predict | epoch, candidates (kind, p) | the pattern table proposed what comes next |
| abstain | kind, door | a proposal was rejected at the named admission gate |
| admit | kind, argv, cwd, epoch | a proposal passed all four gates |
| speculate | kind | a speculative run launched |
| serve | kind, outcome, savedMs, waitMs | codex asked; hit, promoted, miss, or unknown |
| outcome | kind, outcome, savedMs, wastedMs | a speculative run settled |
| counterfactual | kind | a result was ready but codex ran the command in the terminal |
| reset | epoch | a file change bumped the epoch, stale entries fenced |
| tokens | total | codex reported cumulative token usage |
| codex | what, command | codex activity, including terminal commands |
| sandbox_seal | layer, probes, workspaceEscapes | wrapper and app-server seal receipts |
| resolution | mode, exitCode, resolved | sealed post-turn verifier result |

## how the report reads these

| report metric | extraction |
| --- | --- |
| wall clock | run wrapper timestamps, spawn to turn completed |
| verification wait | codex exec to done pairs for verification commands, plus waitMs on serve events |
| tool call wait p50 and p95 | waitMs pooled over all serve events per mode |
| overlap | savedMs on served results plus runtimes of wasted runs |
| served and hit rate | serve outcomes: hit and promoted count as served |
| wasted cpu | wastedMs on discarded and preempted outcomes |
| tokens | max cumulative total per run |

The extraction code is `aggregate()` in `scripts/bench.mjs`. Every run is recorded and reported. Resolution (the failing tests re run after the turn, recorded as `resolved`) gates the end to end wall and token medians only; trace level metrics count every run.
