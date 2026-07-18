import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/scheduler.mjs';

function fakeExecutor() {
  const jobs = [];
  return {
    jobs,
    execute(argv, cwd) {
      const job = { argv, cwd, terminated: false };
      job.promise = new Promise((resolve) => {
        job.resolve = resolve;
      });
      job.terminate = () => {
        job.terminated = true;
      };
      jobs.push(job);
      return { promise: job.promise, terminate: job.terminate };
    },
  };
}

function fakeCache() {
  let epoch = 0;
  const entries = [];
  return {
    entries,
    epoch: () => epoch,
    bumpEpoch() {
      epoch++;
      for (const e of entries) {
        if (!e.outcome && !e.promoted && e.epoch < epoch) {
          e.terminate();
          e.outcome = 'discarded';
        }
      }
    },
    put(job) {
      entries.push(Object.assign(job, { promoted: false, outcome: null }));
    },
    preemptable() {
      let best = null;
      for (const e of entries) {
        if (e.outcome || e.promoted) continue;
        if (!best || e.utility < best.utility) best = e;
      }
      return best;
    },
    kill(kind) {
      const e = entries.find((x) => x.kind === kind && !x.outcome);
      if (e) {
        e.terminate();
        e.outcome = 'preempted';
      }
    },
  };
}

const R = {
  TEST: { argv: ['pytest', '-q'], cwd: '/r' },
  LINT: { argv: ['ruff', 'check'], cwd: '/r' },
  TYPECHECK: { argv: ['mypy', '.'], cwd: '/r' },
  RUN: { argv: ['python', 'app.py'], cwd: '/r' },
};

function setup({ proposals, budget }) {
  const events = [];
  const executor = fakeExecutor();
  const cache = fakeCache();
  const scheduler = createScheduler({
    cache,
    verifiers: { resolve: (kind) => R[kind] ?? null },
    predictor: { propose: () => proposals.shift() ?? [] },
    executor,
    onEvent: (e) => events.push(e),
    budget,
  });
  return { scheduler, executor, cache, events };
}

test('two patterns proposing same kind and argv launch once', () => {
  const { scheduler, executor, events } = setup({
    proposals: [[{ kind: 'TEST', p: 0.9 }, { kind: 'TEST', p: 0.8 }]],
  });
  scheduler.onFileChange();
  assert.equal(executor.jobs.length, 1);
  assert.equal(scheduler.inflightCount(), 1);
  assert.equal(events.filter((e) => e.type === 'abstain').length, 0);
});

test('each door failure emits its abstain, zero launches', () => {
  const { scheduler, executor, events } = setup({
    proposals: [[
      { kind: 'BUILD', p: 0.9 },
      { kind: 'RUN', p: 0.9 },
      { kind: 'LINT', p: 0.1 },
      { kind: 'TEST', p: 0.9 },
    ]],
    budget: 0,
  });
  scheduler.onFileChange();
  assert.equal(executor.jobs.length, 0);
  assert.deepEqual(
    events.filter((e) => e.type === 'abstain').map((e) => [e.type, e.kind, e.door]),
    [
      ['abstain', 'BUILD', 'executable'],
      ['abstain', 'RUN', 'policy'],
      ['abstain', 'LINT', 'confident'],
      ['abstain', 'TEST', 'budget'],
    ],
  );
});

test('budget launches two of three admitted candidates', () => {
  const { scheduler, executor, events } = setup({
    proposals: [[
      { kind: 'TEST', p: 0.9 },
      { kind: 'LINT', p: 0.8 },
      { kind: 'TYPECHECK', p: 0.7 },
    ]],
  });
  scheduler.onFileChange();
  assert.equal(executor.jobs.length, 2);
  assert.deepEqual(executor.jobs.map((j) => j.argv[0]), ['pytest', 'ruff']);
  assert.equal(scheduler.inflightCount(), 2);
  const abstains = events.filter((e) => e.type === 'abstain');
  assert.equal(abstains.length, 1);
  assert.equal(abstains[0].door, 'budget');
  assert.equal(abstains[0].kind, 'TYPECHECK');
});

test('authoritative start preempts lowest utility, promoted survives', () => {
  const { scheduler, executor, cache } = setup({
    proposals: [[{ kind: 'TEST', p: 0.9 }, { kind: 'LINT', p: 0.5 }]],
  });
  scheduler.onFileChange();
  cache.entries.find((e) => e.kind === 'LINT').promoted = true;
  scheduler.onAuthoritativeCommandStart();
  assert.equal(executor.jobs.find((j) => j.argv[0] === 'pytest').terminated, true);
  assert.equal(cache.entries.find((e) => e.kind === 'TEST').outcome, 'preempted');
  assert.equal(executor.jobs.find((j) => j.argv[0] === 'ruff').terminated, false);
  assert.equal(scheduler.inflightCount(), 1);
});

test('epoch bump kills stale job, next trigger relaunches under new epoch', () => {
  const { scheduler, executor, cache } = setup({
    proposals: [[{ kind: 'TEST', p: 0.9 }], [{ kind: 'TEST', p: 0.9 }]],
  });
  scheduler.onFileChange();
  const stale = executor.jobs[0];
  scheduler.onFileChange();
  assert.equal(stale.terminated, true);
  assert.equal(cache.entries[0].outcome, 'discarded');
  assert.equal(executor.jobs.length, 2);
  assert.equal(cache.entries[1].epoch, 2);
  assert.equal(scheduler.inflightCount(), 1);
});

test('session start pre runs the suite at epoch 0', () => {
  const { scheduler, executor, events } = setup({ proposals: [[]] });
  scheduler.onSessionStart();
  assert.equal(executor.jobs.length, 1);
  const spec = events.find((e) => e.type === 'speculate');
  assert.equal(spec.kind, 'TEST');
  assert.equal(spec.epoch, 0);
});

test('session start result is fenced by the first edit', () => {
  const { scheduler, executor, cache } = setup({ proposals: [[]] });
  scheduler.onSessionStart();
  assert.equal(executor.jobs.length, 1);
  scheduler.onFileChange();
  assert.equal(cache.epoch(), 1);
  assert.equal(scheduler.inflightCount(), 0);
});
