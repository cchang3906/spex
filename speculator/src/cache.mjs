const TTL_MS = 600000;

export function createCache(onEvent) {
  let epoch = 0;
  const entries = new Map();

  function settle(entry, outcome, savedMs, wastedMs, t) {
    if (entry.outcome) return;
    entry.outcome = outcome;
    onEvent({ type: 'outcome', kind: entry.kind, outcome, savedMs, wastedMs, epoch: entry.epoch, t });
  }

  function discard(entry, now) {
    if (entry.outcome) return;
    const wastedMs = entry.status === 'running' ? now - entry.startedAt : entry.durationMs;
    if (entry.status === 'running') entry.terminate();
    settle(entry, 'discarded', 0, wastedMs, now);
  }

  function put(job) {
    const prev = entries.get(job.kind);
    if (prev && !prev.outcome) discard(prev, Date.now());
    const entry = { ...job, status: 'running', promoted: false, outcome: null, result: null, finishedAt: null, durationMs: null };
    entries.set(job.kind, entry);
    job.promise.then(
      (result) => {
        entry.status = 'done';
        entry.finishedAt = Date.now();
        entry.durationMs = result?.durationMs ?? entry.finishedAt - entry.startedAt;
        entry.result = result;
        if (!entry.outcome) onEvent({ type: 'ready', kind: entry.kind, durationMs: entry.durationMs, epoch: entry.epoch, t: entry.finishedAt });
      },
      () => {
        entry.status = 'done';
        entry.finishedAt = Date.now();
        entry.durationMs = entry.finishedAt - entry.startedAt;
        discard(entry, entry.finishedAt);
      },
    );
  }

  function servable(kind, now) {
    const entry = entries.get(kind);
    if (!entry || entry.outcome) return false;
    if (entry.epoch !== epoch) return false;
    if (entry.status === 'done' && now - entry.finishedAt > TTL_MS) return false;
    return true;
  }

  async function serve(kind, now) {
    const entry = entries.get(kind);
    if (!entry || entry.outcome) return null;
    if (entry.epoch !== epoch) {
      discard(entry, now);
      return null;
    }
    if (entry.status === 'done') {
      if (now - entry.finishedAt > TTL_MS) {
        discard(entry, now);
        return null;
      }
      const savedMs = Math.min(entry.durationMs, now - entry.startedAt);
      settle(entry, 'reused', savedMs, 0, now);
      return { result: entry.result, savedMs };
    }
    entry.promoted = true;
    const result = await entry.promise;
    const savedMs = Math.min(now - entry.startedAt, entry.durationMs);
    settle(entry, 'promoted', savedMs, 0, now);
    return { result, savedMs };
  }

  function bumpEpoch() {
    epoch++;
    const now = Date.now();
    onEvent({ type: 'reset', epoch, t: now });
    for (const entry of entries.values()) {
      if (!entry.outcome && !entry.promoted && entry.epoch < epoch && entry.status === 'running') discard(entry, now);
    }
  }

  function sweep(now) {
    for (const entry of entries.values()) {
      if (!entry.outcome && entry.status === 'done' && now - entry.finishedAt > TTL_MS) discard(entry, now);
    }
  }

  function preemptable() {
    let best = null;
    for (const entry of entries.values()) {
      if (entry.outcome || entry.promoted || entry.status !== 'running') continue;
      if (!best || entry.utility < best.utility) best = entry;
    }
    return best;
  }

  function kill(kind) {
    const entry = entries.get(kind);
    if (!entry || entry.outcome || entry.status !== 'running') return;
    const now = Date.now();
    entry.terminate();
    settle(entry, 'preempted', 0, now - entry.startedAt, now);
  }

  return { epoch: () => epoch, put, serve, servable, bumpEpoch, sweep, preemptable, kill };
}
