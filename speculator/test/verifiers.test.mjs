import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVerifiers } from '../src/verifiers.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('../../data/fixtures_argv.json', import.meta.url))).fixtures;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'verifiers-'));

test('every fixture classifies to its expected kind', () => {
  const v = createVerifiers(tmp());
  for (const f of fixtures) assert.equal(v.classify(f.raw), f.expect, f.raw);
});

test('learn then resolve returns learned argv and cwd', () => {
  const v = createVerifiers(tmp());
  v.learn("/bin/zsh -lc 'python3 -m pytest -q'", '/repo/app');
  assert.deepEqual(v.resolve('TEST'), { argv: ['python3', '-m', 'pytest', '-q'], cwd: '/repo/app' });
});

test('persistence round trip across instances', () => {
  const dir = tmp();
  createVerifiers(dir).learn('npm test', dir);
  const v2 = createVerifiers(dir);
  assert.deepEqual(v2.resolve('TEST'), { argv: ['npm', 'test'], cwd: dir });
});

test('corrupt state file starts empty and falls through to config tier', () => {
  const dir = tmp();
  const state = path.join(dir, '.prefetch');
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, 'verifiers.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
  const v = createVerifiers(dir);
  assert.deepEqual(v.resolve('TEST'), { argv: ['npm', 'test'], cwd: dir });
});

test('config tier resolves package.json scripts.test to npm test', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  assert.deepEqual(createVerifiers(dir).resolve('TEST'), { argv: ['npm', 'test'], cwd: dir });
});
