let vnow = 0;
Date.now = () => vnow;

export function makeClock() {
  vnow = 0;
  return {
    now: () => vnow,
    advance: (ms) => { vnow += ms; },
    set: (t) => { if (t > vnow) vnow = t; },
  };
}

export function makeExecutor(clock, durationMs = 7000) {
  const jobs = [];
  const api = {
    jobs,
    launches: 0,
    onLaunch: null,
    execute(argv, cwd) {
      api.launches++;
      let res;
      const promise = new Promise((r) => (res = r));
      const job = {
        argv,
        cwd,
        kind: argv[1],
        startedAt: clock.now(),
        finishAt: clock.now() + durationMs,
        done: false,
        promoted: false,
        finish() {
          if (job.done) return;
          job.done = true;
          res({ code: 0, durationMs: clock.now() - job.startedAt || durationMs });
        },
      };
      jobs.push(job);
      if (api.onLaunch) api.onLaunch(job);
      return { promise, terminate: () => job.finish() };
    },
    resolveDue() {
      for (const j of jobs) if (!j.done && j.finishAt <= clock.now()) j.finish();
    },
    running: () => jobs.filter((j) => !j.done),
  };
  return api;
}

export const flush = () => new Promise((r) => setImmediate(r));

// serve must not await a promise nobody will resolve: a promotion joins the
// running job, so the ask itself fast forwards the clock to the job's finish
export async function ask(cache, executor, clock, kind) {
  const now = clock.now();
  const joinable = cache.servable(kind, now) && executor.running().find((j) => j.kind === kind);
  const p = cache.serve(kind, now);
  if (joinable) {
    joinable.promoted = true;
    clock.set(joinable.finishAt);
    joinable.finish();
    await flush();
  }
  return p;
}
