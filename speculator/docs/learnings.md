# learnings, live testing notes

running list of what live runs taught us that specs and traces did not. no names, no dates, safe to publish.

1. git history contaminates behavior, not just steering text. a "reseed" commit that visibly re-broke fixed code sent codex into commit by commit forensics (git log --reverse -p, git show <sha>:file) and it ended the turn without editing at all. demo repos must be REGENERATED fresh for every run, bug present from commit 1, single initial commit. scripts/make-demo-repo.sh does this (steered and --baseline variants)

2. binary files break codex's apply_patch verification. running the suite creates __pycache__/*.pyc; codex choked reading one mid patch ("invalid utf-8"). demo repos need .gitignore for __pycache__ and .prefetch from the first commit

3. child processes inherit NODE_OPTIONS. a stale preload path in the parent environment made the spawned codex crash on boot. transport strips NODE_OPTIONS when spawning (spawn env hygiene)

4. the demo suite must be slow enough to feel. a 0.1s toy suite produced savedMs=98, technically a hit, visually nothing. at 4s the same flow produced a promotion with savedMs=2621. plan's 3 to 6 second suite spec is confirmed by experience

5. the first verification of a session is the repro run, before any edit. it used to be a guaranteed miss (measured 15 to 17.7 seconds of waiting); cold start speculation now pre runs the suite at epoch 0 so that ask is served instead. the pre run is fenced by the first edit like any stale entry

6. promotion is the common live hit shape, not reuse. codex asks a few seconds after the edit, while the suite is still running; the ask joins the job and saves the head start. reuse (fully finished before ask) needs a suite shorter than codex's post edit typing time

7. codex reports durationMs 0 on commandExecution completions in this build. do not trust that field for metrics; use our own executor timing (we already do)

8. status stream is noisy: repeated idle/active flips and multiple turn/completed style notifications per run. renderers must dedupe; raw event log keeps everything

9. steering held live: the model routed verification through prefetch_verify unprompted, including its pre edit repro run. the replay eval's 21 sessions served 21 of 21 eligible asks, and the behavior reproduces on a different machine and repo

10. a historical dashboard does not need a second trace format. the stored daemon events already contain wall-clock timestamps, tool boundaries, speculation launches, and outcomes; rebuilding the timeline from that contract keeps live and postmortem views comparable and avoids persisting browser-specific svg geometry
