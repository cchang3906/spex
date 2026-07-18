# speculation design

how spex decides to run a tool before codex asks, and why that is always safe. this is the prod design doc: every rule here maps to code.

the one line version: predict the verification, run it on a spare burner, keep the plate on a shelf codex cannot see, serve it only when codex orders exactly that dish, and throw it out the moment the code changes.

## vocabulary

- kind: what codex asks for, one of test, lint, typecheck, build
- argv plus cwd: the concrete command and the folder it runs from, resolved by verifiers
- epoch: an integer version of the workspace. any file change increments it
- job: one speculative execution. carries kind, argv, cwd, epoch, status, utility
- cache: the shelf. map from (kind, epoch) to a job and its result
- authoritative: anything codex itself asked for. always outranks speculation

## admission

speculation never launches just because a prediction exists. a prediction is a candidate, admission is the decision to spend a burner on it.

- triggers, two of them: a completed file change from codex (native edit or a mutating shell command), which is the post edit verify predicted from the pattern table; and session start, the cold start pre run, where the suite launches at epoch 0 with p treated as 1 because reproducing the failing state is the most predictable act in a session. both pass through the same admission gates
- the predictor looks up the recent event window in the pattern table and proposes candidates (kind plus probability)
- candidates are deduplicated before anything else: two patterns proposing the same (argv, cwd, epoch) collapse into one job. the key is a hash of those three. concretely, [EDIT] predicts TEST and [READ, EDIT] predicts TEST at the same moment, both resolve to the same pytest run, one suite run is enough
- a candidate that is already in flight or already cached for the current epoch is dropped silently
- admission is policy plus current conditions, never a blind launch. all four checks below must pass

## admission checks

four doors, in order, cheapest veto first. failing any door is called an abstain. abstains are silent, cost nothing, and are logged with which door refused. abstaining is correct behavior, not an error.

- door 1, executable: verifiers.resolve(kind) must return a concrete argv plus cwd. no argv means nothing to run, abstain. this door also encodes the learning story: a fresh repo abstains here until codex runs verification once and the listener learns it
- door 2, policy safe: the argv head must be on the declared allow list (test, lint, typecheck, build families). no network access, no side effects, never inferred from context. if it is not on the list it does not run, no matter how confident the prediction
- door 3, confident: effective probability must clear tau (0.35). effective probability blends the mined prior with online counts from this session. the prior weight applies only to contexts the mined table actually contains, unseen contexts trust the online estimate directly
- door 4, budget: at most 2 speculative jobs in flight. this is a counting semaphore. the laptop runs codex, the daemon, and the demo, so speculation gets two burners and no more

## speculation level and priority

how far a job may run, and who goes first when candidates compete.

- everything we speculate is side effect free by construction, because door 2 only admits verification commands. so every admitted job runs end to end, full execution, real output captured
- the paper has middle tiers (preparation only, safe variants for tools with side effects). we do not need them: tools with side effects are simply never admitted. that is a scope choice, not a gap
- when two candidates pass all doors and compete for a burner, order by utility: probability times expected hidden seconds. expected hidden seconds is the last observed duration for that kind, default 5000 ms when unknown
- example: test at p 0.87 with a 7 second suite scores 6.1, lint at p 0.58 with a 3 second run scores 1.7. test launches first

## non interference

speculation must never slow down or alter the real work. two guarantees, resource and correctness.

- resource: authoritative commands keep their normal priority. speculative jobs only use spare capacity inside the budget
- when codex starts its own command and the burners are full, the lowest utility speculative job is terminated immediately to make room. termination uses the executor's kill, the job is marked preempted
- a job that has been promoted (see below) is never preempted, it is real work now
- correctness: speculative results live only in the cache. the daemon has no push channel to codex. nothing is injected, nothing appears in session history, the transcript cannot contain a speculative result that was not explicitly requested
- worst case of a wrong guess: bounded cpu heat and one entry that gets thrown away. tokens spent: zero, the model never sees discarded work

## match and promotion

the moment codex actually asks, and how a guess becomes real.

- codex asks through the dynamic tool: prefetch_verify with a kind. matching is a cache lookup on (kind, current epoch). no string comparison, no canonicalization at serve time, the tool vocabulary and the cache key are the same words by design
- the paper must canonicalize argv strings to match. we moved matching into the tool interface instead, which makes it exact
- three outcomes of the lookup:
  - completed entry, current epoch: serve it immediately. this is a hit, the wait was hidden
  - entry still running, current epoch: promote it. the ask attaches to the running job (join, never rerun), the job becomes authoritative and non preemptible, the result serves the moment it finishes. saved time equals whatever head start the job had
  - nothing servable: a miss. resolve the argv and run it right now as authoritative work, return that. if even the argv is unknown, answer honestly that no verifier is configured yet and let codex use the terminal once, the listener learns from it
- stale entries never serve. an entry from an older epoch is invisible to the lookup, because test results about code that no longer exists are worse than no results
- saved time per hit is min(tool duration, ask time minus speculation start), computed from real timestamps, never assumed

## misses and signals

every speculative job ends in exactly one of four states, set once, logged always.

- reused: finished, codex asked, served from the shelf. commits a result
- promoted: asked while still running, joined, served on finish. commits a result
- discarded: never asked for, or its epoch died, or its ttl (10 minutes) expired. silent
- preempted: killed to make room for authoritative work. silent
- only reused and promoted ever deliver anything to codex. the other two are invisible to the session by construction
- every ending emits one event on the websocket feed: type, kind, outcome, saved ms, wasted ms, epoch. the dashboard counters are literally counts and sums of these endings, wait hidden, hit rate, wasted speculation seconds, lead time
- the paper feeds these same signals to its co scheduler for gpu pacing. we have no shared gpu to pace, so the signals feed the dashboard instead. same telemetry, different consumer

## what this buys, in one table

| paper concept          | our implementation                          |
|------------------------|---------------------------------------------|
| speculative path       | scheduler launches through the one executor  |
| isolation              | pull only cache, no push channel exists      |
| admission checks       | four doors, cheapest veto first              |
| utility ordering       | p times expected hidden seconds              |
| preemption             | kill lowest utility on real contention       |
| match                  | (kind, epoch) lookup on the dynamic tool     |
| promotion              | join the running job, mark non preemptible   |
| lossless guarantee     | miss equals codex without us                 |
| signals                | four outcomes streamed to the dashboard      |
