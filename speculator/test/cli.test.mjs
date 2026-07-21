import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, stripWrapper } from '../src/cli.mjs';

function harness(times = [], columns = 100) {
  const out = [];
  let i = 0;
  const r = createRenderer((s) => out.push(s), {
    now: () => (i < times.length ? times[i++] : 0),
    width: () => columns,
  });
  return { r, text: () => out.join('') };
}

function toolItem(kind, text) {
  return {
    type: 'dynamicToolCall',
    tool: 'prefetch_verify',
    arguments: { kind },
    contentItems: [{ type: 'inputText', text }],
  };
}

test('stripWrapper removes zsh wrapper and quotes', () => {
  assert.equal(stripWrapper('/bin/zsh -lc pwd'), 'pwd');
  assert.equal(stripWrapper("/bin/zsh -lc 'npm test'"), 'npm test');
  assert.equal(stripWrapper('bash -c "ls -la"'), 'ls -la');
  assert.equal(stripWrapper('npm test'), 'npm test');
});

test('agent message deltas stream inline', () => {
  const { r, text } = harness();
  r.onMessage({ method: 'item/agentMessage/delta', params: { delta: 'hello ' } });
  r.onMessage({ method: 'item/agentMessage/delta', params: { delta: 'world' } });
  r.onMessage({ method: 'item/completed', params: { item: { type: 'agentMessage' } } });
  assert.equal(text(), '\x1b[2m•\x1b[0m hello world\n');
});

test('command chip renders only at completion with status and highlighting', () => {
  const { r, text } = harness();
  r.onMessage({
    method: 'item/started',
    params: { item: { type: 'commandExecution', id: 'c1', command: '/bin/zsh -lc pwd' } },
  });
  assert.equal(text(), '');
  r.onMessage({
    method: 'item/completed',
    params: { item: { type: 'commandExecution', id: 'c1', command: '/bin/zsh -lc pwd', exitCode: 0, durationMs: 12 } },
  });
  assert.equal(text(), '\x1b[32m•\x1b[0m \x1b[1mRan\x1b[0m \x1b[34mpwd\x1b[39m\x1b[0m\n');
});

test('command completion after streamed text preserves both blocks', () => {
  const { r, text } = harness();
  r.onMessage({
    method: 'item/started',
    params: { item: { type: 'commandExecution', id: 'c1', command: '/bin/zsh -lc pwd' } },
  });
  r.onMessage({ method: 'item/agentMessage/delta', params: { delta: 'ok' } });
  r.onMessage({
    method: 'item/completed',
    params: { item: { type: 'commandExecution', id: 'c1', command: '/bin/zsh -lc pwd', exitCode: 1, durationMs: 1500 } },
  });
  assert.equal(
    text(),
    '\x1b[2m•\x1b[0m ok\n\n' +
      '\x1b[31m•\x1b[0m \x1b[1mRan\x1b[0m \x1b[34mpwd\x1b[39m\x1b[0m\n' +
      '  \x1b[2m└ exit 1\x1b[0m\n',
  );
});

test('cache hit renders only with the completed tool result', () => {
  const { r, text } = harness();
  r.onEvent({ type: 'serve', kind: 'test', outcome: 'hit', savedMs: 4200, waitMs: 40 });
  assert.equal(text(), '');
  r.onMessage({
    method: 'item/completed',
    params: {
      item: toolItem(
        'test',
        'verifier: python -m pytest\nexit code: 0\nduration: 4.2s\n--- output (tail) ---\n\n3 passed\n',
      ),
    },
  });
  const t = text();
  assert.ok(t.startsWith('\x1b[48;5;58m\x1b[33m▌'));
  assert.ok(t.includes('Called prefetch_verify(test)'));
  assert.ok(t.includes('⚡ cache hit'));
  assert.ok(!t.includes('saved'));
  assert.ok(t.includes('3 passed'));
  assert.deepEqual(r.stats(), { hits: 1, savedMs: 4200, tokens: 0 });
});

test('promoted result uses the cache-hit row and records saved time', () => {
  const { r, text } = harness();
  r.onEvent({ type: 'serve', kind: 'lint', outcome: 'promoted', savedMs: 3100, waitMs: 900 });
  r.onMessage({
    method: 'item/completed',
    params: {
      item: toolItem(
        'lint',
        'verifier: ruff check\nexit code: 0\nduration: 4.0s\n--- output (tail) ---\n\nAll checks passed\n',
      ),
    },
  });
  const t = text();
  assert.ok(t.startsWith('\x1b[48;5;58m\x1b[33m▌'));
  assert.ok(t.includes('Called prefetch_verify(lint)'));
  assert.ok(t.includes('⚡ cache hit'));
  assert.ok(!t.includes('saved'));
  assert.ok(t.includes('All checks passed'));
  assert.deepEqual(r.stats(), { hits: 1, savedMs: 3100, tokens: 0 });
});

test('joined subagent result counts as a shared cache serve', () => {
  const { r, text } = harness();
  r.onEvent({ type: 'serve', kind: 'test', outcome: 'joined', savedMs: 0, waitMs: 20 });
  r.onMessage({
    method: 'item/completed',
    params: {
      item: toolItem(
        'test',
        'verifier: pytest\nexit code: 0\nduration: 1.0s\n--- output (tail) ---\n\n2 passed\n',
      ),
    },
  });
  assert.ok(text().includes('⚡ cache hit'));
  assert.deepEqual(r.stats(), { hits: 1, savedMs: 0, tokens: 0 });
});

test('miss renders the fresh duration, exit status, and output', () => {
  const { r, text } = harness();
  r.onEvent({ type: 'serve', kind: 'test', outcome: 'miss', savedMs: 0, waitMs: 2500, epoch: 0 });
  r.onMessage({
    method: 'item/completed',
    params: {
      item: toolItem(
        'test',
        'verifier: pytest\nexit code: 1\nduration: 2.5s\n--- output (tail) ---\n\nFAILED x\n',
      ),
    },
  });
  const t = text();
  assert.ok(t.includes('Called prefetch_verify(test)'));
  assert.ok(t.includes('cold start · ran fresh 2.5s'));
  assert.ok(t.includes('\x1b[31m1\x1b[0m'));
  assert.ok(t.includes('FAILED x'));
  assert.ok(!t.includes('⚡ cache hit'));
  assert.deepEqual(r.stats(), { hits: 0, savedMs: 0, tokens: 0 });
});

test('unknown outcome renders a plain honest line', () => {
  const { r, text } = harness();
  r.onEvent({ type: 'serve', kind: 'build', outcome: 'unknown', savedMs: 0 });
  assert.equal(text(), '');
  r.onMessage({
    method: 'item/completed',
    params: {
      item: toolItem(
        'build',
        'no verifier configured yet for this repo. run your verification in the terminal this once.',
      ),
    },
  });
  assert.ok(text().includes('Called prefetch_verify(build)'));
  assert.ok(text().includes('no verifier for this repo yet'));
  assert.ok(!text().includes('cache hit'));
});

test('reasoning and unrelated events render nothing', () => {
  const { r, text } = harness();
  r.onMessage({ method: 'item/started', params: { item: { type: 'reasoning', id: 'r1' } } });
  r.onMessage({ method: 'item/completed', params: { item: { type: 'reasoning', id: 'r1' } } });
  r.onMessage({ method: 'turn/diff/updated', params: {} });
  r.onEvent({ type: 'sched', kind: 'test' });
  r.onEvent({ type: 'outcome', kind: 'test', outcome: 'discarded' });
  assert.equal(text(), '');
});

test('turn completed closes the stream with a newline', () => {
  const { r, text } = harness();
  r.onMessage({ method: 'item/agentMessage/delta', params: { delta: 'done' } });
  r.onMessage({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  assert.equal(text(), '\x1b[2m•\x1b[0m done\n\n');
});
