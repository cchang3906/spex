import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCache } from './cache.mjs';
import { createPredictor } from './predictor.mjs';
import { createScheduler } from './scheduler.mjs';
import { createServe } from './serve.mjs';
import { createVerifiers } from './verifiers.mjs';

function workspaceFor(repoDir) {
  const path = realpathSync(resolve(repoDir));
  const stat = statSync(path);
  if (!stat.isDirectory()) throw new TypeError('repoDir must be a directory');
  return Object.freeze({ id: `${stat.dev}:${stat.ino}`, path });
}

function registrationFor(value, parentSessionId) {
  if (typeof value === 'string') return { sessionId: value, parentSessionId: parentSessionId ?? null };
  if (!value || typeof value !== 'object') throw new TypeError('session registration must be a string or object');
  return { sessionId: value.sessionId, parentSessionId: value.parentSessionId ?? null };
}

function validSessionId(value, label = 'sessionId') {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function editSignature(event) {
  if (typeof event.sig === 'string') return event.sig;
  const path = event.changes?.[0]?.path ?? '';
  const ext = String(path).split('.').pop().toLowerCase();
  const cls = ext === 'py' || ext === 'pyi'
    ? 'py'
    : ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(ext)
      ? 'js'
      : ['json', 'yaml', 'yml', 'toml', 'txt', 'md'].includes(ext)
        ? 'config'
        : 'other';
  return `EDIT(${cls})`;
}

export function measureFanout(events) {
  const speculations = new Set();
  const serves = new Set();
  let crossSessionServes = 0;
  for (const event of events) {
    if (event?.type === 'speculate') {
      speculations.add(event.entryId ?? `${event.epoch}:${event.kind}:${event.t}`);
    }
    if (event?.type === 'serve' && ['hit', 'reused', 'promoted', 'joined'].includes(event.outcome)) {
      serves.add(event.claimId ?? `${event.sessionId}:${event.entryId}:${event.t}`);
      if (
        typeof event.originSessionId === 'string' &&
        typeof event.sessionId === 'string' &&
        event.originSessionId !== event.sessionId
      ) crossSessionServes++;
    }
  }
  return Object.freeze({
    speculations: speculations.size,
    serves: serves.size,
    crossSessionServes,
    servesPerSpeculation: speculations.size === 0 ? 0 : serves.size / speculations.size,
  });
}

export function createDaemon({
  repoDir,
  onEvent = () => {},
  cacheFactory = createCache,
  predictorFactory,
  schedulerFactory = createScheduler,
  serveFactory = createServe,
  verifierFactory = createVerifiers,
  verifierResolver,
  executor,
  tablePath = process.env.SPEX_TABLE ?? fileURLToPath(new URL('../../data/pattern_table.json', import.meta.url)),
  enabled = true,
} = {}) {
  if (typeof repoDir !== 'string' || repoDir.length === 0) throw new TypeError('repoDir must be a non-empty string');
  if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
  const workspace = workspaceFor(repoDir);
  const trace = [];
  const sessions = new Map();
  let closed = false;

  function epochOf(cache) {
    return typeof cache.epoch === 'function' ? cache.epoch() : cache.epoch;
  }

  function emit(value) {
    const event = Object.freeze({
      t: Date.now(),
      epoch: 0,
      ...value,
      sessionId: value.sessionId ?? value.originSessionId ?? 'daemon',
      workspaceId: workspace.id,
    });
    trace.push(event);
    onEvent(event);
    return event;
  }

  const cache = cacheFactory(emit);
  const publicCache = new Proxy(cache, {
    get(target, property, receiver) {
      if (property === 'epoch') return epochOf(target);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const verifiers = verifierResolver
    ? {
        resolve: (kind) => verifierResolver(String(kind).toLowerCase(), workspace.path)
          ?? verifierResolver(String(kind).toUpperCase(), workspace.path),
        classify: () => null,
        learn() {},
      }
    : verifierFactory(workspace.path);
  const makePredictor = predictorFactory ?? (() => createPredictor(tablePath));
  const firstPredictor = makePredictor(tablePath, { onEvent: emit });
  let firstPredictorClaimed = false;
  const proposalProxy = { propose: () => [] };

  const scheduler = enabled
    ? schedulerFactory({
        cache,
        verifiers: { resolve: (kind) => verifiers.resolve(String(kind).toUpperCase()) },
        predictor: proposalProxy,
        executor,
        onEvent: emit,
        allow: ['test', 'lint', 'typecheck', 'build'],
      })
    : { onFileChange() {}, onSessionStart() {}, onAuthoritativeCommandStart() {}, shutdown() {} };

  const serve = serveFactory({ cache, verifiers, executor, onEvent: emit });

  function assertOpen() {
    if (closed) throw new Error('daemon is closed');
  }

  function requireSession(sessionId) {
    assertOpen();
    validSessionId(sessionId);
    const state = sessions.get(sessionId);
    if (!state || state.detached) throw new Error(`unknown daemon session: ${sessionId}`);
    return state;
  }

  function predictorForSession() {
    if (!firstPredictorClaimed) {
      firstPredictorClaimed = true;
      return firstPredictor;
    }
    return makePredictor(tablePath, { onEvent: () => {} });
  }

  function proposalsFor(state) {
    const proposals = state.predictor.propose?.() ?? [];
    return proposals.map(({ kind, p }) => ({ kind: String(kind).toLowerCase(), p }));
  }

  function observeFor(state, event) {
    assertOpen();
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('session event must be an object');
    if (typeof event.threadId === 'string' && event.threadId !== state.sessionId) {
      throw new Error('event thread does not match its daemon session');
    }
    const tagged = { ...event, sessionId: state.sessionId };
    if (tagged.type === 'exec_begin') scheduler.onAuthoritativeCommandStart(state.sessionId);
    const isEdit = tagged.type === 'edit' || tagged.type === 'fileChange';
    if (isEdit) {
      const sig = editSignature(tagged);
      for (const session of sessions.values()) session.predictor.reset?.(epochOf(cache) + 1);
      state.predictor.observe?.(sig);
      const proposals = proposalsFor(state);
      scheduler.onFileChange(
        proposals.length > 0 ? proposals : [{ kind: 'test', p: 1 }],
        state.sessionId,
      );
      emit({ ...tagged, sig, epoch: epochOf(cache) });
      return Promise.resolve();
    }
    if (typeof tagged.sig === 'string') state.predictor.observe?.(tagged.sig);
    emit({ ...tagged, epoch: epochOf(cache) });
    return Promise.resolve();
  }

  function verifyFor(state, args, context = {}) {
    if (sessions.get(state.sessionId) !== state || state.detached) {
      return Promise.reject(new Error(`daemon session is detached: ${state.sessionId}`));
    }
    return Promise.resolve(serve.handleToolCall(
      { tool: 'prefetch_verify', arguments: args },
      { ...context, sessionId: state.sessionId, threadId: state.sessionId },
    )).then((response) => response?.contentItems?.[0]?.text ?? response);
  }

  function adapterFor(state) {
    if (state.adapter) return state.adapter;
    state.adapter = Object.freeze({
      get epoch() { return epochOf(cache); },
      get workspaceId() { return workspace.id; },
      parentSessionId: state.parentSessionId,
      sessionId: state.sessionId,
      observe: (event) => observeFor(state, event),
      unregister: () => detachSession(state.sessionId),
      verify: (args, context = {}) => verifyFor(state, args, context),
    });
    return state.adapter;
  }

  function attachSession(value, parentSessionId) {
    assertOpen();
    const registration = registrationFor(value, parentSessionId);
    const sessionId = validSessionId(registration.sessionId);
    if (registration.parentSessionId !== null) {
      validSessionId(registration.parentSessionId, 'parentSessionId');
      if (!sessions.has(registration.parentSessionId)) {
        throw new Error(`unknown parent daemon session: ${registration.parentSessionId}`);
      }
    }
    const existing = sessions.get(sessionId);
    if (existing) {
      if (existing.parentSessionId !== registration.parentSessionId) throw new Error(`session parent changed: ${sessionId}`);
      return adapterFor(existing);
    }
    const state = {
      sessionId,
      parentSessionId: registration.parentSessionId,
      predictor: predictorForSession(),
      detached: false,
      adapter: null,
    };
    sessions.set(sessionId, state);
    emit({ type: 'session', action: 'attach', sessionId, parentSessionId: state.parentSessionId, epoch: epochOf(cache) });
    scheduler.onSessionStart(sessionId);
    return adapterFor(state);
  }

  function detachSession(sessionId) {
    const state = sessions.get(sessionId);
    if (!state || state.detached) return false;
    for (const child of [...sessions.values()]) {
      if (child.parentSessionId === sessionId) detachSession(child.sessionId);
    }
    state.detached = true;
    sessions.delete(sessionId);
    emit({ type: 'session', action: 'detach', sessionId, parentSessionId: state.parentSessionId, epoch: epochOf(cache) });
    return true;
  }

  function handle(args, context = {}) {
    if (
      typeof context.sessionId === 'string' &&
      typeof context.threadId === 'string' &&
      context.sessionId !== context.threadId
    ) throw new Error('tool context session does not match its thread');
    const state = requireSession(context.threadId ?? context.sessionId);
    return verifyFor(state, args, context);
  }

  async function shutdown() {
    if (closed) return;
    closed = true;
    await scheduler.shutdown?.();
    cache.close?.();
    for (const state of sessions.values()) state.detached = true;
    sessions.clear();
  }

  return Object.freeze({
    get epoch() { return epochOf(cache); },
    get events() { return [...trace]; },
    get sessions() {
      return [...sessions.values()].map(({ sessionId, parentSessionId }) => ({ sessionId, parentSessionId }));
    },
    get amortization() { return measureFanout(trace); },
    cache: publicCache,
    firstPredictor,
    handle,
    hasSession: (sessionId) => sessions.has(sessionId),
    observe: (sessionId, event) => observeFor(requireSession(sessionId), event),
    ready: Promise.resolve(),
    register: attachSession,
    attachSession,
    detachSession,
    scheduler,
    serve,
    verifiers,
    shutdown,
    workspace,
    flushEvents: () => Promise.resolve(),
  });
}

export { createDaemon as createSessionRegistry };
