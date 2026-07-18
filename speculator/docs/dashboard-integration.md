# dashboard product integration handoff

this guide is for the next codex or claude session that wires the dashboard into the functioning spex daemon. read `docs/architecture.md` first, then inspect every file named below before editing. preserve the graph geometry and metric definitions unless the event contract proves they are wrong.

## current boundary

the dashboard is not a static mock. `src/dashboard.html` consumes the same json events as the cli through server-sent events:

```text
codex app-server notifications
-> src/router.mjs
-> scheduler / cache / serve events
-> src/events.mjs
-> .prefetch/events.jsonl + dashboard sink
-> src/dashboard.mjs GET /events
-> src/dashboard.html
```

`src/dashboard.mjs` serves the page on `127.0.0.1:7777`, retains the latest 500 lines for reconnects, and sends new lines to every connected browser. `src/events.mjs` remains the authoritative fan-out point. do not add a second dashboard-only event emitter.

the browser currently derives geometry and session metrics from the event stream. completed traces are copied into `localStorage` under `spex.dashboard.traces.v1` for the session picker and jsonl export. this is useful for the prototype, but it is not durable product persistence and must not replace `.prefetch/events.jsonl`.

## event contract the dashboard uses

| source | event | dashboard meaning |
| --- | --- | --- |
| `src/router.mjs` | `{ type: "codex", what: "exec", command }` | agent tool phase begins |
| `src/router.mjs` | `{ type: "codex", what: "done", command, exitCode, durationMs }` | agent tool phase ends |
| `src/router.mjs` | `{ type: "codex", what: "edit", path, sig }` | editing phase and epoch change |
| `src/router.mjs` | `{ type: "codex", what: "status", detail }` | turn lifecycle evidence |
| `src/scheduler.mjs` | `{ type: "predict", epoch, candidates }` | prediction context |
| `src/scheduler.mjs` | `{ type: "speculate", kind, argv, epoch }` | shadow branch launches |
| `src/serve.mjs` | `{ type: "serve", kind, outcome, savedMs, waitMs, epoch }` | request hits, joins, or misses speculation |
| `src/cache.mjs` | `{ type: "outcome", kind, outcome, savedMs, wastedMs, epoch }` | speculative work is reused, promoted, discarded, or preempted |
| `src/cache.mjs` | `{ type: "reset", epoch }` | cache epoch bump after an edit |
| `src/router.mjs` | `{ type: "tokens", total }` | token telemetry for the ledger |

keep `t` as an integer unix timestamp in milliseconds on every event. historical timeline reconstruction in `buildHistoryModel()` depends on it.

## canonical metrics

the top panel intentionally shows each metric for the selected session and across all sessions.

| metric | definition |
| --- | --- |
| cache hits | count `serve` events where `outcome === "hit"` |
| speculations launched | count `speculate` events |
| speculations served | count `serve` events where `outcome` is `hit` or `promoted` |
| latency saved | sum `savedMs` from served speculative results |

`promoted` is a speculation serve, but not a completed cache hit. do not combine those two labels. totals must deduplicate by a stable session ID and must include an active unarchived session at most once.

## required product wiring

### 1. add a stable session identity

the current event envelope has no durable codex session/thread identifier. add one at the earliest point where the app-server thread ID is known, then preserve it through `src/events.mjs`.

preferred envelope:

```js
{
  t: 1784390000000,
  sessionId: "codex-thread-id",
  sequence: 42,
  type: "speculate",
  kind: "test",
  epoch: 3
}
```

use a monotonic per-session `sequence` to disambiguate events with the same millisecond timestamp and to support SSE resume. do not infer session identity from epoch, cwd, event timing, or array position.

### 2. separate session lifecycle from epoch lifecycle

this is the highest-risk integration issue. `src/cache.mjs` emits `type: "reset"` whenever an edit bumps the cache epoch. that is not a completed codex session. the demo replay in `src/dashboard.mjs` also emits `reset` as a replay boundary, so the prototype currently overloads the name.

introduce explicit lifecycle events such as:

```js
{ type: "session", what: "started", sessionId }
{ type: "session", what: "completed", sessionId, reason }
```

then change `src/dashboard.html` so `finishSession()` runs only for the explicit session completion event. keep cache resets inside the same timeline as epoch boundaries. if the product wants per-turn history instead, name it `turnId` and make that choice explicit in the UI.

### 3. make history authoritative outside the browser

add read-only history routes to `src/dashboard.mjs` or to the product API that owns persisted sessions:

```text
GET /api/sessions
GET /api/sessions/:sessionId/events
GET /events?sessionId=:sessionId
```

the session list should return ID, started/completed timestamps, repository label, status, and the four canonical session metrics. the event route should return the original ordered events. keep jsonl export generated from those original events.

once those routes exist:

- replace `loadHistory()` and `persistHistory()` in `src/dashboard.html` with API reads
- retain `localStorage` only as an optional last-view preference
- populate `#session-select` from `GET /api/sessions`
- keep `buildHistoryModel()` as the browser projection unless server-side projection becomes necessary for very large traces
- keep the live option bound to SSE and archived options bound to immutable event history

### 4. make SSE reconnectable and session-aware

the current 500-line in-memory backlog is sufficient for the demo, not for durable reconnects. emit SSE `id:` values from the per-session sequence and honor `Last-Event-ID`. if the requested sequence is no longer in memory, replay the missing range from authoritative jsonl/session storage before switching to the live sink.

never mix events from two codex sessions in one browser model without `sessionId` filtering.

### 5. preserve the renderer boundary

keep these responsibilities in `src/dashboard.html`:

- `handle()` maps live events into the active view model
- `buildHistoryModel()` reconstructs an archived timeline from raw events
- `render()` owns SVG geometry only
- `traceMetrics()`, `selectedMetrics()`, and `totalMetrics()` own browser metric projection
- `renderMetricChart()` owns the selected metric comparison

do not move scheduler, cache, or serving decisions into the dashboard. the interface is an observer; the daemon remains the control plane.

## likely alterations

- replace the demo-only overloaded `reset` boundary with explicit session lifecycle events
- pass `sessionId`, `sequence`, repository display name, and lifecycle status through the event envelope
- replace browser-only trace history with authoritative session queries
- cap or virtualize the event ledger for long-running sessions; it currently renders at most 500 rows
- decide whether totals mean this daemon, this repository, or the entire benchmark corpus, then label and query that scope explicitly
- redact command arguments and paths before remote exposure; current localhost rendering assumes the user owns the machine
- keep the server bound to loopback unless authentication, authorization, CSRF, and trace redaction are implemented

## acceptance checks

run from `speculator/`:

```bash
npm test
node --check src/dashboard.mjs
node src/dashboard.mjs demo/events-demo.jsonl
```

then verify through source-level or browser-level tests:

1. two concurrent sessions never share events or totals
2. an edit increments epoch without creating a new session
3. live -> completed archives exactly once
4. selecting an archived session changes the postmortem, metric graph, queue timeline, and export together
5. cache hit excludes promoted work; speculation served includes it
6. totals do not double-count the just-completed active session
7. a reload reconstructs identical metrics and geometry from authoritative events
8. SSE reconnect resumes without gaps or duplicates
9. reduced-motion mode keeps all information visible without animation

## files to review before changing the contract

- `src/main.mjs`: daemon composition and dashboard/event sink wiring
- `src/events.mjs`: authoritative jsonl and sink fan-out
- `src/router.mjs`: codex app-server notification mapping
- `src/scheduler.mjs`: prediction admission and speculation launch
- `src/cache.mjs`: epoch fencing and speculative outcomes
- `src/serve.mjs`: hit, promotion, miss, and latency evidence
- `src/dashboard.mjs`: localhost HTTP/SSE transport
- `src/dashboard.html`: session projection, metrics, and SVG renderer
- `docs/architecture.md`: runtime boundaries that must remain accurate

do not introduce a frontend framework solely to wire these routes. the current zero-build page is sufficient unless the product already establishes a shared React runtime elsewhere.
