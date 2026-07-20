import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/cache.mjs';

function fakeJob(kind, { epoch = 0, startedAt = 1000, utility = 1 } = {}) {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  let terminated = 0;
  const job = { kind, argv: [kind], cwd: '/repo', epoch, promise, terminate: () => terminated++, startedAt, utility };
  return { job, resolve, terminatedCount: () => terminated };
}

function setup() {
  const events = [];
  return { cache: createCache((e) => events.push(e)), events };
}

const tick = () => new Promise((r) => setImmediate(r));

test('serve after done returns identical result, outcome reused', async () => {
  const { cache, events } = setup();
  const f = fakeJob('test');
  cache.put(f.job);
  const result = { exitCode: 0, output: 'ok', durationMs: 500 };
  f.resolve(result);
  await tick();
  const served = await cache.serve('test', f.job.startedAt + 200);
  assert.equal(served.result, result);
  assert.equal(events.filter((e) => e.type === 'outcome').length, 1);
  assert.equal(events.filter((e) => e.type === 'outcome')[0].outcome, 'reused');
});

test('serve while running joins the promise, one execution, outcome promoted', async () => {
  const { cache, events } = setup();
  const f = fakeJob('test');
  cache.put(f.job);
  const pending = cache.serve('test', f.job.startedAt + 100);
  const result = { exitCode: 0, output: 'ok', durationMs: 500 };
  f.resolve(result);
  const served = await pending;
  assert.equal(served.result, result);
  assert.equal(f.terminatedCount(), 0);
  assert.equal(events.filter((e) => e.type === 'outcome').length, 1);
  assert.equal(events.filter((e) => e.type === 'outcome')[0].outcome, 'promoted');
});

test('serve with nothing returns null', async () => {
  const { cache, events } = setup();
  assert.equal(await cache.serve('lint', 1000), null);
  assert.equal(events.length, 0);
});

test('bumpEpoch makes an older done entry unservable', async () => {
  const { cache, events } = setup();
  const f = fakeJob('test');
  cache.put(f.job);
  f.resolve({ exitCode: 0, output: 'ok', durationMs: 500 });
  await tick();
  cache.bumpEpoch();
  assert.equal(await cache.serve('test', f.job.startedAt + 600), null);
  const outcomes = events.filter((e) => e.type === 'outcome');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].outcome, 'discarded');
  assert.equal(events.filter((e) => e.type === 'reset').length, 1);
});

test('bumpEpoch terminates an older running entry', async () => {
  const { cache, events } = setup();
  const f = fakeJob('test');
  cache.put(f.job);
  cache.bumpEpoch();
  assert.equal(f.terminatedCount(), 1);
  const outcomes = events.filter((e) => e.type === 'outcome');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].outcome, 'discarded');
});

test('ttl expiry serves null, outcome discarded', async () => {
  const { cache, events } = setup();
  const f = fakeJob('test');
  cache.put(f.job);
  f.resolve({ exitCode: 0, output: 'ok', durationMs: 500 });
  await tick();
  assert.equal(await cache.serve('test', Date.now() + 601000), null);
  assert.equal(events.filter((e) => e.type === 'outcome').length, 1);
  assert.equal(events.filter((e) => e.type === 'outcome')[0].outcome, 'discarded');
});

test('outcomes emitted sum to jobs created, each exactly once', async () => {
  const { cache, events } = setup();
  const a = fakeJob('test');
  cache.put(a.job);
  a.resolve({ exitCode: 0, output: 'a', durationMs: 100 });
  await tick();
  await cache.serve('test', a.job.startedAt + 50);
  const b = fakeJob('lint');
  cache.put(b.job);
  const pending = cache.serve('lint', b.job.startedAt + 50);
  b.resolve({ exitCode: 0, output: 'b', durationMs: 100 });
  await pending;
  const c = fakeJob('build');
  cache.put(c.job);
  cache.kill('build');
  const d = fakeJob('typecheck', { epoch: cache.epoch() });
  cache.put(d.job);
  cache.bumpEpoch();
  const outcomeEvents = events.filter((e) => e.type === 'outcome');
  assert.equal(outcomeEvents.length, 4);
  assert.deepEqual(
    outcomeEvents.map((e) => [e.kind, e.outcome]).sort(),
    [['build', 'preempted'], ['lint', 'promoted'], ['test', 'reused'], ['typecheck', 'discarded']],
  );
});

test('savedMs math for reuse and promotion', async () => {
  const { cache } = setup();
  const a = fakeJob('test', { startedAt: 0 });
  cache.put(a.job);
  a.resolve({ exitCode: 0, output: 'a', durationMs: 7000 });
  await tick();
  const reused = await cache.serve('test', 8000);
  assert.equal(reused.savedMs, 7000);
  const b = fakeJob('lint', { startedAt: 0 });
  cache.put(b.job);
  const pending = cache.serve('lint', 3000);
  b.resolve({ exitCode: 0, output: 'b', durationMs: 7000 });
  const promoted = await pending;
  assert.equal(promoted.savedMs, 3000);
});
