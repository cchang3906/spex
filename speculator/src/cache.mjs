const TTL_MS = 600000;

function clockFor(clock) {
  if (typeof clock === 'function') return clock;
  if (clock && typeof clock.now === 'function') return () => clock.now();
  throw new TypeError('clock must be a function or expose now');
}

export function createCache(onEvent = () => {}, { clock = Date.now, ttlMs = TTL_MS } = {}) {
  const now = clockFor(clock);
  let epoch = 0;
  let generation = 0;
  let entrySequence = 0;
  let claimSequence = 0;
  let joinedClaims = 0;
  let closed = false;
  const entries = new Map();
  const claims = new WeakMap();
  const settlements = [];

  function emit(event) {
    onEvent(event);
    return event;
  }

  function settle(entry, outcome, savedMs, wastedMs, t, fields = {}) {
    if (entry.outcome) return;
    entry.outcome = outcome;
    const record = { outcome, savedMs, wastedMs };
    settlements.push(record);
    emit({
      type: 'outcome',
      kind: entry.kind,
      outcome,
      savedMs,
      wastedMs,
      epoch: entry.epoch,
      entryId: entry.id,
      originSessionId: entry.originSessionId,
      ...fields,
      t,
    });
  }

  function discard(entry, at, outcome = 'discarded') {
    if (entry.outcome) return;
    entry.invalid = true;
    const wastedMs = entry.status === 'running' ? Math.max(0, at - entry.startedAt) : entry.durationMs;
    if (entry.status === 'running') entry.terminate?.();
    settle(entry, outcome, 0, wastedMs ?? 0, at);
  }

  function put(job) {
    if (closed) throw new Error('cache is closed');
    const kind = String(job.kind).toLowerCase();
    const prev = entries.get(kind);
    if (prev && !prev.outcome) discard(prev, now());
    const entry = {
      ...job,
      id: ++entrySequence,
      kind,
      status: 'running',
      promoted: false,
      outcome: null,
      result: null,
      finishedAt: null,
      durationMs: null,
      invalid: false,
      generation,
      originSessionId: job.sessionId ?? null,
      primaryClaim: null,
    };
    entries.set(kind, entry);
    job.promise.then(
      (result) => {
        entry.status = 'done';
        entry.finishedAt = Number.isFinite(result?.finishedAt) ? result.finishedAt : now();
        entry.durationMs = result?.durationMs ?? Math.max(0, entry.finishedAt - entry.startedAt);
        entry.result = result;
        if (!entry.outcome && !entry.invalid) {
          emit({
            type: 'ready',
            kind: entry.kind,
            durationMs: entry.durationMs,
            epoch: entry.epoch,
            entryId: entry.id,
            originSessionId: entry.originSessionId,
            sessionId: entry.originSessionId,
            t: entry.finishedAt,
          });
        }
      },
      () => {
        entry.status = 'done';
        entry.finishedAt = now();
        entry.durationMs = Math.max(0, entry.finishedAt - entry.startedAt);
        discard(entry, entry.finishedAt);
      },
    );
    return Object.freeze({ id: entry.id, kind: entry.kind, epoch: entry.epoch });
  }

  function currentEntry(kind, requestedEpoch, at) {
    const entry = entries.get(String(kind).toLowerCase());
    if (!entry || entry.invalid || entry.outcome && !entry.primaryClaim) return null;
    if (requestedEpoch !== epoch || entry.epoch !== epoch) return null;
    if (entry.status === 'done' && at - entry.finishedAt > ttlMs) {
      discard(entry, at);
      return null;
    }
    return entry;
  }

  function servable(kind, value = now()) {
    const valueIsEpoch = Number.isInteger(value) && value >= 0 && value <= epoch;
    return currentEntry(kind, valueIsEpoch ? value : epoch, valueIsEpoch ? now() : value) !== null;
  }

  async function serve(kind, at) {
    const entry = entries.get(String(kind).toLowerCase());
    if (!entry || entry.outcome) return null;
    if (entry.epoch !== epoch) {
      discard(entry, at);
      return null;
    }
    if (entry.status === 'done') {
      if (at - entry.finishedAt > ttlMs) {
        discard(entry, at);
        return null;
      }
      const savedMs = Math.min(entry.durationMs, Math.max(0, at - entry.startedAt));
      settle(entry, 'reused', savedMs, 0, at);
      return { result: entry.result, savedMs };
    }
    entry.promoted = true;
    const result = await entry.promise;
    if (entry.invalid || entry.epoch !== epoch) return null;
    const savedMs = Math.min(entry.durationMs, Math.max(0, at - entry.startedAt));
    settle(entry, 'promoted', savedMs, 0, at);
    return { result, savedMs };
  }

  function claim({ kind, epoch: requestedEpoch = epoch, askTime = now(), sessionId = null } = {}) {
    const entry = currentEntry(kind, requestedEpoch, askTime);
    if (!entry) return null;
    const outcome = entry.primaryClaim
      ? 'joined'
      : entry.status === 'done'
        ? 'reused'
        : 'promoted';
    const ticket = Object.freeze({
      id: ++claimSequence,
      entryId: entry.id,
      kind: entry.kind,
      epoch: entry.epoch,
      outcome,
      askTime,
      ready: entry.promise,
    });
    const record = { ticket, entry, outcome, sessionId, generation, committed: false, receipt: undefined };
    claims.set(ticket, record);
    if (!entry.primaryClaim) {
      entry.primaryClaim = record;
      entry.promoted = outcome === 'promoted';
    }
    return ticket;
  }

  function receiptFor(record) {
    const { entry, ticket, outcome } = record;
    const primary = entry.primaryClaim;
    const primarySaved = primary.outcome === 'reused'
      ? entry.durationMs
      : Math.min(entry.durationMs, Math.max(0, primary.ticket.askTime - entry.startedAt));
    const savedMs = outcome === 'joined' ? 0 : primarySaved;
    const waitMs = outcome === 'reused'
      ? 0
      : outcome === 'promoted'
        ? Math.max(0, entry.durationMs - primarySaved)
        : Math.max(0, entry.finishedAt - ticket.askTime);
    return Object.freeze({
      entryId: entry.id,
      claimId: ticket.id,
      kind: entry.kind,
      epoch: entry.epoch,
      originSessionId: entry.originSessionId,
      outcome,
      askTime: ticket.askTime,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      durationMs: entry.durationMs,
      savedMs,
      waitMs,
      result: entry.result,
    });
  }

  function commit(ticket, deliver = null) {
    const record = claims.get(ticket);
    if (!record) throw new TypeError('unknown cache ticket');
    if (record.committed) return record.receipt;
    const { entry } = record;
    if (
      entry.invalid ||
      entry.epoch !== epoch ||
      record.generation !== generation ||
      entry.status !== 'done' ||
      !entry.result
    ) {
      record.committed = true;
      record.receipt = null;
      return null;
    }
    const receipt = receiptFor(record);
    if (!entry.outcome) {
      const primary = entry.primaryClaim;
      const primaryReceipt = receiptFor(primary);
      settle(entry, primary.outcome, primaryReceipt.savedMs, 0, now(), {
        sessionId: primary.sessionId,
        claimId: primary.ticket.id,
      });
    }
    if (record.outcome === 'joined') joinedClaims++;
    record.committed = true;
    record.receipt = receipt;
    if (deliver) deliver(receipt);
    return receipt;
  }

  function deliver(requestedEpoch, callback) {
    if (requestedEpoch !== epoch) return null;
    const value = callback();
    return requestedEpoch === epoch ? value : null;
  }

  function bumpEpoch(sessionId = 'daemon') {
    epoch++;
    generation++;
    const at = now();
    emit({ type: 'reset', epoch, sessionId, t: at });
    for (const entry of entries.values()) {
      if (!entry.outcome && entry.epoch < epoch) discard(entry, at);
    }
    return epoch;
  }

  function reset({ epoch: nextEpoch = epoch + 1 } = {}) {
    if (!Number.isInteger(nextEpoch) || nextEpoch < epoch) throw new RangeError('cache epoch cannot move backwards');
    while (epoch < nextEpoch) bumpEpoch();
    return epoch;
  }

  function sweep(at = now()) {
    for (const entry of entries.values()) {
      if (!entry.outcome && entry.status === 'done' && at - entry.finishedAt > ttlMs) discard(entry, at);
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
    const entry = entries.get(String(kind).toLowerCase());
    if (!entry || entry.outcome || entry.status !== 'running') return;
    discard(entry, now(), 'preempted');
  }

  function ledger() {
    const totals = {
      savedMs: 0,
      wastedMs: 0,
      outcomes: { reused: 0, promoted: 0, joined: joinedClaims, discarded: 0, preempted: 0 },
    };
    for (const record of settlements) {
      totals.savedMs += record.savedMs;
      totals.wastedMs += record.wastedMs;
      totals.outcomes[record.outcome]++;
    }
    return totals;
  }

  function close() {
    if (closed) return;
    for (const entry of entries.values()) if (!entry.outcome) discard(entry, now());
    closed = true;
  }

  return {
    epoch: () => epoch,
    put,
    serve,
    claim,
    commit,
    deliver,
    servable,
    bumpEpoch,
    reset,
    sweep,
    preemptable,
    kill,
    ledger,
    close,
  };
}
