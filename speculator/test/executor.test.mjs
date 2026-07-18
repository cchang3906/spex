import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutor } from '../src/executor.mjs';

function fakeSend(calls, result) {
  return (method, params) => {
    calls.push({ method, params });
    return Promise.resolve(method === 'command/exec' ? result : {});
  };
}

test('execute sends command/exec with exact params and maps result', async () => {
  const calls = [];
  const executor = createExecutor(fakeSend(calls, { exitCode: 1, stdout: 'out\n', stderr: 'err\n' }));
  const handle = executor.execute(['python3', '-m', 'unittest'], '/tmp/repo');
  const result = await handle.promise;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'command/exec');
  const p = calls[0].params;
  assert.deepEqual(p.command, ['python3', '-m', 'unittest']);
  assert.equal(p.cwd, '/tmp/repo');
  assert.equal(p.timeoutMs, 120000);
  assert.equal(typeof p.processId, 'string');
  assert.deepEqual(p.sandboxPolicy, {
    type: 'workspaceWrite',
    writableRoots: ['/tmp/repo'],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.output, 'out\nerr\n');
  assert.equal(typeof result.durationMs, 'number');
  assert.ok(result.durationMs >= 0);
});

test('terminate sends command/exec/terminate with the exec processId', async () => {
  const calls = [];
  const executor = createExecutor(fakeSend(calls, { exitCode: 137, stdout: '', stderr: '' }));
  const handle = executor.execute(['sleep', '30'], '/tmp/repo');
  await handle.terminate();

  assert.equal(calls[1].method, 'command/exec/terminate');
  assert.deepEqual(calls[1].params, { processId: calls[0].params.processId });
  assert.equal((await handle.promise).exitCode, 137);
});

test('distinct executions get distinct processIds', () => {
  const calls = [];
  const executor = createExecutor(fakeSend(calls, { exitCode: 0, stdout: '', stderr: '' }));
  executor.execute(['pwd'], '/a');
  executor.execute(['pwd'], '/b');
  assert.notEqual(calls[0].params.processId, calls[1].params.processId);
});
