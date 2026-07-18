import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, stripWrapper } from '../src/cli.mjs';

function harness(times = []) {
  const out = [];
  let i = 0;
  const r = createRenderer(
    (s) => out.push(s),
    () => (i < times.length ? times[i++] : 0),
  );
  return { r, text: () => out.join('') };
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
  assert.equal(text(), 'hello world');
});

test('command chip gets exit code and duration appended', () => {
  const { r, text } = harness();
  r.onMessage({
    method: 'item/started',
    params: { item: { type: 'commandExecution', id: 'c1', command: '/bin/zsh -lc pwd' } },
  });
  r.onMessage({
    method: 'item/completed',
    params: { item: { type: 'commandExecution', id: 'c1', command: '/bin/zsh -lc pwd', exitCode: 0, durationMs: 12 } },
  });
  assert.equal(text(), '\x1b[2m$ pwd · exit 0 · 12ms\x1b[0m\n');
});

test('interrupted chip falls back to a completion line', () => {
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
  const t = text();
  assert.ok(t.includes('$ pwd\x1b[0m\n'));
  assert.ok(t.includes('$ pwd · exit 1 · 1.5s\x1b[0m\n'));
});

test('cache hit line is yellow with served and saved ms', () => {
  const { r, text } = harness([1000, 1040]);
  r.onMessage({ method: 'item/tool/call', params: { tool: 'prefetch_verify', arguments: { kind: 'test' } } });
  r.onEvent({ type: 'serve', kind: 'test', outcome: 'hit', savedMs: 4200 });
  const t = text();
  assert.ok(t.includes('\x1b[33m'));
  assert.ok(t.includes('⚡ prefetch_verify(test) served in 40ms · hid 4200ms of wait'));
});

test('promoted also renders the yellow line', () => {
  const { r, text } = harness([0, 900]);
  r.onMessage({ method: 'item/tool/call', params: { tool: 'prefetch_verify', arguments: { kind: 'lint' } } });
  r.onEvent({ type: 'serve', kind: 'lint', outcome: 'promoted', savedMs: 3100 });
  assert.ok(text().includes('\x1b[33m⚡ prefetch_verify(lint) served in 900ms · hid 3100ms of wait'));
});

test('miss line is plain with duration and no ansi color', () => {
  const { r, text } = harness([0, 2500]);
  r.onMessage({ method: 'item/tool/call', params: { tool: 'prefetch_verify', arguments: { kind: 'test' } } });
  r.onEvent({ type: 'serve', kind: 'test', outcome: 'miss', savedMs: 0 });
  assert.equal(text(), 'prefetch_verify(test) ran fresh (2500ms)\n');
  assert.ok(!text().includes('\x1b['));
});

test('unknown outcome renders a plain honest line', () => {
  const { r, text } = harness();
  r.onEvent({ type: 'serve', kind: 'build', outcome: 'unknown', savedMs: 0 });
  assert.equal(text(), 'prefetch_verify(build) has no verifier for this repo yet\n');
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
  assert.equal(text(), 'done\n\n');
});
