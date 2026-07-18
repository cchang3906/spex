export function createScheduler({ cache, verifiers, predictor, executor, onEvent, allow = ['TEST', 'LINT', 'TYPECHECK', 'BUILD'], tau = 0.35, budget = 2 }) {
  const inflight = new Map();
  const launched = new Map();
  const lastMs = new Map();

  function launch(c) {
    const startedAt = Date.now();
    const { promise, terminate } = executor.execute(c.argv, c.cwd);
    const job = { kind: c.kind, argv: c.argv, cwd: c.cwd, epoch: c.epoch, promise, terminate, startedAt, utility: c.utility };
    inflight.set(c.key, job);
    launched.set(c.key, c.epoch);
    cache.put(job);
    onEvent({ type: 'speculate', kind: c.kind, argv: c.argv, epoch: c.epoch, t: startedAt });
    const done = () => {
      if (inflight.get(c.key) === job) inflight.delete(c.key);
    };
    promise.then((r) => {
      lastMs.set(c.kind, r?.durationMs ?? Date.now() - startedAt);
      done();
    }, done);
  }

  function onFileChange() {
    cache.bumpEpoch();
    const epoch = cache.epoch();
    // stale jobs stop counting against the speculative budget: the cache killed the plain ones and promoted ones are authoritative work now
    for (const [key, job] of inflight) if (job.epoch < epoch) inflight.delete(key);
    for (const [key, e] of launched) if (e < epoch) launched.delete(key);
    consider(predictor.propose(), epoch);
  }

  // cold start: reproducing the failing state is the most predictable act in the
  // session, so the suite is pre run at epoch 0 before the model says a word.
  // one edit and the result is fenced like any other stale entry.
  function onSessionStart() {
    const testKind = allow.find((k) => String(k).toUpperCase() === 'TEST') ?? 'test';
    consider([{ kind: testKind, p: 1 }], cache.epoch());
  }

  function consider(proposals, epoch) {
    const t = Date.now();
    onEvent({ type: 'predict', epoch, candidates: proposals.map((c) => ({ kind: c.kind, p: Number(c.p.toFixed(3)) })), t });
    const admitted = [];
    for (const { kind, p } of proposals) {
      const abstain = (door) => onEvent({ type: 'abstain', kind, door, epoch, t });
      const resolved = verifiers.resolve(kind);
      if (!resolved) {
        abstain('executable');
        continue;
      }
      if (!allow.includes(kind)) {
        abstain('policy');
        continue;
      }
      if (p < tau) {
        abstain('confident');
        continue;
      }
      const key = resolved.argv.join(' ') + resolved.cwd + epoch;
      if (launched.has(key) || admitted.some((c) => c.key === key)) continue;
      admitted.push({ kind, key, epoch, argv: resolved.argv, cwd: resolved.cwd, utility: p * (lastMs.get(kind) ?? 5000) });
    }
    admitted.sort((a, b) => b.utility - a.utility);
    for (const c of admitted) onEvent({ type: 'admit', kind: c.kind, argv: c.argv, cwd: c.cwd, epoch, t });
    for (const c of admitted) {
      if (inflight.size >= budget) {
        onEvent({ type: 'abstain', kind: c.kind, door: 'budget', epoch, t });
        continue;
      }
      launch(c);
    }
  }

  function onAuthoritativeCommandStart() {
    if (inflight.size < budget) return;
    const victim = cache.preemptable();
    if (!victim) return;
    cache.kill(victim.kind);
    for (const [key, job] of inflight) if (job.kind === victim.kind && job.epoch === victim.epoch) inflight.delete(key);
  }

  return { onFileChange, onSessionStart, onAuthoritativeCommandStart, inflightCount: () => inflight.size };
}
