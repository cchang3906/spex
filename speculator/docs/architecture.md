# implementation

spex is a single javascript daemon, one process, zero dependencies, no build step. it launches `codex app-server` as a child process and speaks json rpc to it over stdio. codex is never modified, forked, or patched: everything flows through the public protocol, and the model runs wherever codex points it. the whole system is a control plane wrapped around an agent we do not own.

## shape

- agent side: one daemon under 1k lines. transport, router, predictor, verifiers, scheduler, executor wrapper, cache, serve handler, learn listener, event feed
- offline side: about 630 lines of python (`mining/`), already run and validated. ingest, normalize, mine, eval. produces the pattern table the daemon loads at boot (a bench clean variant, mined with all benchmark instances excluded, is selected via `SPEX_TABLE`)
- interface side: a cli that renders codex like codex (`src/cli.mjs`) and a localhost dashboard over a server sent event feed (`src/dashboard.mjs`), both strict renderers of the same event stream
- codex keeps its native tools untouched. we register exactly one addition at thread start, the `prefetch_verify` dynamic tool, and steer verification through it with one file (AGENTS.md). remove the daemon and codex is exactly codex

## the predictor

next step candidates are served by hash map lookups over serialized context keys, constant time per lookup, about a hundred nanoseconds. no model, no inference: the last k tool signatures of the live session form a string key, and the table answers with what usually comes next and how often. online counts blend with the mined prior during the session, so a repo's local habits sharpen the table while it runs.

the daemon also speculates before any prediction exists: at session start the test suite is pre run at epoch 0, because reproducing the failing state is the most predictable act in a session. the first verification, previously a guaranteed miss, becomes a hit worth the entire suite duration. one edit and the result is fenced like any other stale entry.

arguments are not predicted from context. verification commands are repo facts, so a three tier lookup resolves them: repo config detection, a command observed once in this session (persisted through restarts in `.prefetch/verifiers.json`), or a stack default. no resolution means no launch, silently.

## the scheduler

two lanes share one executor. agent issued invocations run in the authoritative lane exactly as codex intended; admitted predictions run in a speculative lane bounded by a two slot budget. both lanes produce results in the same shape through the same `execute(argv, cwd)` wrapper, so a speculative result is byte for byte interchangeable with a real one.

results meet in one cache keyed by kind and epoch. when codex calls the tool and a completed entry is fresh, it is served in milliseconds. when the matching speculation is still running, the request joins it, the job is promoted to authoritative priority, and the answer arrives the moment the run finishes, having banked its head start. when nothing matches, the tool runs normally and codex experiences plain codex.

every edit bumps the epoch; entries and in flight runs from older epochs can never serve. wrong guesses end discarded or preempted, never seen, their cost bounded by the budget and counted honestly in the event stream.

## integration cost

codex needs zero changes. the user swaps one command, and a repo opts in with one steering file. every event the daemon emits (prediction, admission, abstention, launch, serve, outcome, tokens) streams to the cli, the dashboard, and a jsonl log simultaneously, so the demo, the metrics, and the benchmark all read the same single source of truth.
