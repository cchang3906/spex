import test from 'node:test';
import assert from 'node:assert/strict';
import { createServe } from '../src/serve.mjs';

function harness({ serve, resolve, classify, servable } = {}) {
  const events = [];
  const learns = [];
  const execs = [];
  const s = createServe({
    cache: { epoch: () => 3, serve: serve ?? (async () => null), servable: servable ?? (() => false) },
    verifiers: {
      resolve: resolve ?? (() => null),
      classify: classify ?? (() => 'OTHER'),
      learn: (cmd, cwd) => learns.push([cmd, cwd]),
    },
    executor: {
      execute(argv, cwd) {
        execs.push([argv, cwd]);
        return { promise: Promise.resolve({ exitCode: 0, output: 'ran fresh\n', durationMs: 500 }), terminate() {} };
      },
    },
    onEvent: (e) => events.push(e),
  });
  return { s, events, learns, execs };
}

test('hit serves the cached output', async () => {
  const { s, events } = harness({
    serve: async () => ({ result: { exitCode: 0, output: 'all 3 tests ok\n', durationMs: 300 }, savedMs: 300 }),
    resolve: () => ({ argv: ['python3', '-m', 'pytest', '-q'], cwd: '/repo' }),
  });
  const res = await s.handleToolCall({ arguments: { kind: 'test' } });
  assert.equal(res.success, true);
  assert.equal(res.contentItems[0].type, 'inputText');
  assert.match(res.contentItems[0].text, /verifier: python3 -m pytest -q/);
  assert.match(res.contentItems[0].text, /exit code: 0/);
  assert.match(res.contentItems[0].text, /duration: 0\.3s/);
  assert.match(res.contentItems[0].text, /all 3 tests ok/);
  assert.deepEqual(events.map((e) => [e.type, e.outcome]), [['serve', 'hit']]);
  assert.equal(events[0].savedMs, 300);
  assert.equal(events[0].epoch, 3);
});

test('promotion awaits the running entry and returns its result', async () => {
  let finish;
  const { s, events } = harness({
    serve: () => new Promise((r) => { finish = r; }),
    resolve: () => ({ argv: ['npm', 'test'], cwd: '/repo' }),
  });
  const pending = s.handleToolCall({ arguments: { kind: 'test' } });
  await null;
  finish({ result: { exitCode: 1, output: 'one failure\n', durationMs: 2000 }, savedMs: 1500 });
  const res = await pending;
  assert.equal(res.success, true);
  assert.match(res.contentItems[0].text, /one failure/);
  assert.match(res.contentItems[0].text, /exit code: 1/);
  assert.deepEqual(events.map((e) => e.outcome), ['promoted']);
  assert.equal(events[0].savedMs, 1500);
});

test('miss with a resolvable verifier executes authoritatively without learning', async () => {
  const { s, events, learns, execs } = harness({
    resolve: (k) => (k === 'TEST' ? { argv: ['npm', 'test'], cwd: '/repo' } : null),
  });
  const res = await s.handleToolCall({ arguments: { kind: 'test' } });
  assert.equal(res.success, true);
  assert.match(res.contentItems[0].text, /verifier: npm test/);
  assert.match(res.contentItems[0].text, /ran fresh/);
  assert.deepEqual(execs, [[['npm', 'test'], '/repo']]);
  assert.equal(learns.length, 0);
  assert.deepEqual(events.map((e) => e.outcome), ['miss']);
});

test('miss with no verifier returns the honest unknown text', async () => {
  const { s, events, execs } = harness();
  const res = await s.handleToolCall({ arguments: { kind: 'lint' } });
  assert.equal(res.success, true);
  assert.equal(res.contentItems[0].text, 'no verifier configured yet for this repo. run your verification in the terminal this once.');
  assert.equal(execs.length, 0);
  assert.deepEqual(events.map((e) => [e.outcome, e.kind]), [['unknown', 'lint']]);
});

test('listener learns from terminal verification and counts the counterfactual', async () => {
  let ready = false;
  const { s, events, learns } = harness({
    servable: () => ready,
    classify: (cmd) => (cmd.includes('pytest') ? 'TEST' : 'OTHER'),
  });
  const cmd = "/bin/zsh -lc 'python3 -m pytest -q'";
  await s.onCommandCompleted({ type: 'commandExecution', status: 'completed', command: cmd, cwd: '/repo' });
  assert.deepEqual(learns, [[cmd, '/repo']]);
  assert.equal(events.length, 0);
  ready = true;
  await s.onCommandCompleted({ type: 'commandExecution', status: 'completed', command: cmd, cwd: '/repo' });
  const cf = events.filter((e) => e.type === 'counterfactual');
  assert.deepEqual(cf, [{ type: 'counterfactual', kind: 'test', epoch: 3, t: cf[0].t }]);
  await s.onCommandCompleted({ type: 'agentMessage', command: 'python3 -m pytest' });
  assert.equal(learns.length, 2);
});
