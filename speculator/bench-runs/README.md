# traces

Every benchmark number in the report is extracted from the raw event logs in this directory. One file per run, named `r{round}-{instance}-{mode}.jsonl`, copied verbatim from the daemon's `.prefetch/events.jsonl` at the end of the run. Nothing is post processed before it lands here: these are the same lines the dashboard streamed live.

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

The extraction code is `aggregate()` in `scripts/bench.mjs`. The gate for a run to count at all is resolution: the failing tests named by the instance are re run after the turn, recorded in `bench-results.jsonl` as `resolved`.
