import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router.mjs';

function harness({ toolResult, daemon = null } = {}) {
  const calls = { fileChange: 0, authStart: 0, toolCalls: [], completed: [], observed: [], warns: [] };
  const responded = [];
  let handler;
  const transport = {
    respond: (id, result) => responded.push([id, result]),
    onMessage: (h) => { handler = h; },
  };
  const router = createRouter({
    scheduler: {
      onFileChange: () => calls.fileChange++,
      onAuthoritativeCommandStart: () => calls.authStart++,
    },
    serve: {
      handleToolCall: async (params) => { calls.toolCalls.push(params); return toolResult; },
      onCommandCompleted: async (item) => { calls.completed.push(item); },
    },
    predictor: { observe: (sig) => calls.observed.push(sig) },
    verifiers: { classify: (cmd) => (cmd.includes('pytest') ? 'TEST' : 'GREP') },
    transport,
    emit: (e) => calls.warns.push(e),
    daemon,
  });
  return { calls, responded, router, inject: (msg) => handler(msg) };
}

const flush = () => new Promise((r) => setImmediate(r));

test('tool call routed to serve and responded', async () => {
  const toolResult = { contentItems: [{ type: 'inputText', text: 'exit code: 0' }], success: true };
  const { calls, responded, inject } = harness({ toolResult });
  inject({ method: 'item/tool/call', id: 7, params: { tool: 'prefetch_verify', arguments: { kind: 'test' } } });
  await flush();
  assert.deepEqual(calls.toolCalls, [{ tool: 'prefetch_verify', arguments: { kind: 'test' } }]);
  assert.deepEqual(responded, [[7, toolResult]]);
});

test('fileChange completion triggers scheduler.onFileChange', () => {
  const { calls, inject } = harness();
  inject({
    method: 'item/completed',
    params: { item: { type: 'fileChange', changes: [{ path: '/repo/calc.py' }], status: 'completed' } },
  });
  assert.equal(calls.fileChange, 1);
  assert.deepEqual(calls.observed, ['EDIT(py)']);
});

test('commandExecution completion reaches serve and predictor, start reaches scheduler', async () => {
  const { calls, inject } = harness();
  const item = { type: 'commandExecution', command: "/bin/zsh -lc 'python3 -m pytest -q'", exitCode: 0, status: 'completed' };
  inject({ method: 'item/started', params: { item } });
  inject({ method: 'item/completed', params: { item } });
  await flush();
  assert.equal(calls.authStart, 1);
  assert.deepEqual(calls.completed, [item]);
  assert.deepEqual(calls.observed, ['TEST(passed)']);
});

test('v2 approval answered accept', () => {
  const { responded, inject } = harness();
  inject({ method: 'item/commandExecution/requestApproval', id: 1, params: {} });
  inject({ method: 'item/fileChange/requestApproval', id: 2, params: {} });
  inject({ method: 'item/permissions/requestApproval', id: 3, params: {} });
  assert.deepEqual(responded, [
    [1, { decision: 'accept' }],
    [2, { decision: 'accept' }],
    [3, { decision: 'accept' }],
  ]);
});

test('legacy approval answered approved', () => {
  const { responded, inject } = harness();
  inject({ method: 'execCommandApproval', id: 4, params: {} });
  inject({ method: 'applyPatchApproval', id: 5, params: {} });
  assert.deepEqual(responded, [
    [4, { decision: 'approved' }],
    [5, { decision: 'approved' }],
  ]);
});

test('unknown request answered with empty result and warn', () => {
  const { calls, responded, inject } = harness();
  inject({ method: 'thread/whatIsThis', id: 9, params: {} });
  assert.deepEqual(responded, [[9, {}]]);
  assert.equal(calls.warns.length, 1);
  assert.equal(calls.warns[0].type, 'warn');
});

test('requestUserInput answered with empty answers map', () => {
  const { responded, inject } = harness();
  inject({ method: 'item/tool/requestUserInput', id: 6, params: { questions: [] } });
  assert.deepEqual(responded, [[6, { answers: {} }]]);
});

test('subagent threads attach to the root daemon and route by thread id', async () => {
  const sessions = new Map();
  const handled = [];
  const detached = [];
  const daemon = {
    workspace: { path: process.cwd() },
    hasSession: (id) => sessions.has(id),
    attachSession({ sessionId, parentSessionId }) {
      sessions.set(sessionId, parentSessionId);
    },
    detachSession(id) {
      detached.push(id);
      sessions.delete(id);
    },
    handle(args, context) {
      handled.push([args, context]);
      return 'shared result';
    },
    observe: async () => {},
  };
  const { router, inject, responded } = harness({ daemon });
  inject({ method: 'thread/started', params: { thread: { id: 'child', parentThreadId: 'parent', cwd: process.cwd() } } });
  router.attachRoot('parent');
  assert.equal(sessions.get('parent'), null);
  assert.equal(sessions.get('child'), 'parent');

  inject({
    method: 'item/tool/call',
    id: 8,
    params: { threadId: 'child', tool: 'prefetch_verify', arguments: { kind: 'test' } },
  });
  await flush();
  assert.deepEqual(handled, [[
    { kind: 'test' },
    { sessionId: 'child', threadId: 'child' },
  ]]);
  assert.deepEqual(responded, [[8, {
    contentItems: [{ type: 'inputText', text: 'shared result' }],
    success: true,
  }]]);

  inject({ method: 'thread/closed', params: { threadId: 'child' } });
  assert.deepEqual(detached, ['child']);
});
