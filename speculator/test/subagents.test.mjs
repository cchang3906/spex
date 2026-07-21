import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCache } from '../src/cache.mjs';
import { createDaemon, measureFanout } from '../src/daemon.mjs';
import { createScheduler } from '../src/scheduler.mjs';
import { createServe, formatTerminalResult } from '../src/serve.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function responseText(response) {
  if (typeof response === 'string') return response;
  return (response?.contentItems ?? [])
    .filter((item) => item?.type === 'inputText')
    .map((item) => item.text)
    .join('');
}

function cacheEpoch(cache) {
  return typeof cache.epoch === 'function' ? cache.epoch() : cache.epoch;
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), 'spex-subagents-'));
  const events = [];
  const executions = [];
  let now = 0;
  const verifier = {
    argv: ['npm', 'test'],
    cwd: root,
  };
  const verifiers = {
    classify: () => null,
    learn() {},
    resolve: (kind) => String(kind).toUpperCase() === 'TEST' ? verifier : null,
  };
  const executor = {
    execute(argv, cwd) {
      const completion = deferred();
      let finished = false;
      let terminated = 0;

      function finish(result) {
        if (finished) return;
        finished = true;
        completion.resolve({ ...result, argv: [...argv], cwd });
      }

      const execution = {
        argv: [...argv],
        cwd,
        startedAt: now,
        promise: completion.promise,
        finish,
        terminate() {
          terminated += 1;
          finish({ exitCode: 1, output: 'STALE\n', durationMs: 100 });
          return completion.promise;
        },
        get terminated() {
          return terminated;
        },
      };
      executions.push(execution);
      return execution;
    },
  };
  const daemon = createDaemon({
    repoDir: root,
    onEvent: (event) => events.push(event),
    cacheFactory: (onEvent) => createCache(onEvent, { clock: () => now }),
    predictorFactory: () => ({
      observe() {},
      propose: () => [{ kind: 'TEST', p: 1 }],
      reset() {},
    }),
    schedulerFactory: (options) => createScheduler({ ...options, clock: () => now }),
    serveFactory: (options) => createServe({ ...options, clock: () => now }),
    verifierFactory: () => verifiers,
    executor,
  });

  t.after(async () => {
    await daemon.shutdown();
    rmSync(root, { force: true, recursive: true });
  });

  return {
    daemon,
    events,
    executions,
    root,
    setNow(value) { now = value; },
  };
}

test('daemon registry enforces parentage and session identity', (t) => {
  const { daemon } = createHarness(t);
  assert.throws(
    () => daemon.attachSession({
      sessionId: 'orphan',
      parentSessionId: 'missing',
    }),
    /unknown parent/u,
  );

  const parent = daemon.register('parent');
  const child = daemon.attachSession({
    sessionId: 'child',
    parentSessionId: 'parent',
  });
  assert.equal(parent.parentSessionId, null);
  assert.equal(child.parentSessionId, 'parent');
  assert.deepEqual(daemon.sessions, [
    { sessionId: 'parent', parentSessionId: null },
    { sessionId: 'child', parentSessionId: 'parent' },
  ]);
  assert.throws(
    () => daemon.attachSession({
      sessionId: 'child',
      parentSessionId: null,
    }),
    /parent changed/u,
  );
  assert.throws(
    () => daemon.handle(
      { kind: 'test' },
      { sessionId: 'parent', threadId: 'child' },
    ),
    /does not match/u,
  );
  assert.equal(child.unregister(), true);
  assert.equal(daemon.hasSession('child'), false);
  assert.equal(daemon.hasSession('parent'), true);
});

test('two sessions share one speculation with a single credit', async (t) => {
  const harness = createHarness(t);
  const parent = harness.daemon.attachSession('parent');
  const child = harness.daemon.attachSession({
    sessionId: 'child',
    parentSessionId: 'parent',
  });
  assert.equal(harness.executions.length, 1);

  harness.setNow(25);
  const parentResponse = parent.verify({ kind: 'test' });
  harness.setNow(40);
  const childResponse = child.verify({ kind: 'test' });
  harness.setNow(100);
  const completed = {
    exitCode: 0,
    output: 'shared verifier bytes\n',
    durationMs: 100,
    startedAt: 0,
    finishedAt: 100,
    command: 'npm test',
  };
  harness.executions[0].finish(completed);

  const [first, second] = await Promise.all([parentResponse, childResponse]);
  assert.equal(first, second);
  assert.equal(first, formatTerminalResult({
    ...completed,
    argv: ['npm', 'test'],
    cwd: harness.root,
  }));
  assert.equal(responseText(first), responseText(second));
  assert.match(responseText(first), /shared verifier bytes/u);
  assert.equal(harness.executions.length, 1);

  const speculations = harness.events.filter((event) => event.type === 'speculate');
  const serves = harness.events.filter((event) => event.type === 'serve');
  assert.equal(speculations.length, 1);
  assert.equal(speculations[0].sessionId, 'parent');
  assert.equal(speculations[0].originSessionId, 'parent');
  assert.deepEqual(serves.map((event) => event.sessionId), ['parent', 'child']);
  assert.deepEqual(serves.map((event) => event.outcome), ['promoted', 'joined']);
  assert.equal(serves[0].entryId, speculations[0].entryId);
  assert.equal(serves[1].entryId, speculations[0].entryId);
  assert.equal(serves[0].outputSha256, serves[1].outputSha256);
  assert.equal(serves[0].responseSha256, serves[1].responseSha256);
  assert.equal(serves[1].originSessionId, 'parent');
  assert.notEqual(serves[0].claimId, serves[1].claimId);
  assert.deepEqual(serves.map((event) => event.savedMs), [25, 0]);
  assert.deepEqual(serves.map((event) => event.waitMs), [75, 60]);
  assert.equal(serves[1].savedMs, 0);
  assert.deepEqual(harness.daemon.cache.ledger(), {
    savedMs: 25,
    wastedMs: 0,
    outcomes: {
      reused: 0,
      promoted: 1,
      joined: 1,
      discarded: 0,
      preempted: 0,
    },
  });

  const expected = {
    speculations: 1,
    serves: 2,
    crossSessionServes: 1,
    servesPerSpeculation: 2,
  };
  assert.deepEqual(measureFanout(harness.events), expected);
  assert.deepEqual(harness.daemon.amortization, expected);
  assert.equal(harness.events.every((event) =>
    typeof event.sessionId === 'string' &&
    event.sessionId.length > 0 &&
    typeof event.workspaceId === 'string'
  ), true);
});

test('an edit from one session fences every session in the workspace', async (t) => {
  const harness = createHarness(t);
  const parent = harness.daemon.attachSession('parent');
  const child = harness.daemon.attachSession({
    sessionId: 'child',
    parentSessionId: 'parent',
  });
  assert.equal(harness.executions.length, 1);

  harness.setNow(10);
  await child.observe({ type: 'edit', changes: [{ path: 'x.mjs' }] });
  assert.equal(parent.epoch, 1);
  assert.equal(child.epoch, 1);
  assert.equal(cacheEpoch(harness.daemon.cache), 1);
  assert.equal(harness.executions[0].terminated, 1);
  assert.equal(harness.daemon.cache.claim({ kind: 'test', epoch: 0 }), null);
  assert.equal(harness.daemon.cache.servable('test', 0), false);
  assert.equal(harness.executions.length, 2);

  harness.setNow(20);
  harness.executions[1].finish({
    exitCode: 0,
    output: 'FRESH\n',
    durationMs: 10,
    startedAt: 10,
    finishedAt: 20,
    command: 'npm test',
  });
  await harness.executions[1].promise;
  await new Promise((resolve) => setImmediate(resolve));

  const response = await parent.verify({ kind: 'test' });
  assert.match(responseText(response), /FRESH/u);
  assert.doesNotMatch(responseText(response), /STALE/u);
  const lastServe = harness.events.filter((event) => event.type === 'serve').at(-1);
  assert.equal(lastServe.sessionId, 'parent');
  assert.equal(lastServe.epoch, 1);
  assert.equal(lastServe.originSessionId, 'child');
});
