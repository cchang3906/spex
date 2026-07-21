#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataset = 'harder-sealed-r1';
const instanceIds = Object.keys(JSON.parse(readFileSync(join(root, 'data', 'swebench-instances.json'), 'utf8')));
const resultRows = readFileSync(join(root, 'bench-results.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((row) => row.dataset === dataset);
const traceRoot = join(root, 'bench-runs', dataset);
const violations = [];
const flaggedAttempts = [];
const servedOutcomes = new Set(['hit', 'reused', 'promoted', 'joined']);
const missOutcomes = new Set(['miss', 'unknown']);

function fail(message) {
  violations.push(message);
}

function inside(workspace, candidate) {
  const path = relative(workspace, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function traceEvents(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSON: ${error.message}`);
      }
    });
}

function commandEscapes(command, workspace, forbidden) {
  const text = String(command ?? '');
  const aliases = [
    ...forbidden,
    '~/.cache/spex-swb',
    '$HOME/.cache/spex-swb',
    'swebench-instances.json',
    'pattern_table_bench.json',
    'tp.diff',
    '/Users/sonia/spex-codex',
  ];
  if (aliases.some((value) => value && text.includes(value))) return true;
  if (/\b(?:find|rg|grep|ls|cat|head|tail)\s+(?:-[^\s]+\s+)*(?:~|\/Users|\/private\/tmp|\/tmp)(?:\/|\s|$)/u.test(text)) return true;
  if (/\bgit\s+(?:-C|--git-dir(?:=|\s+))\s*(?:~|\/Users|\/private\/tmp|\/tmp)/u.test(text)) return true;
  const absolutePaths = text.match(/\/(?:Users|private|tmp|home|var)\/[^\s"'`;|&)>]+/gu) ?? [];
  return absolutePaths.some((value) => {
    const candidate = resolve(value.replace(/[,:]+$/u, ''));
    return !inside(workspace, candidate) && /\b(?:find|rg|grep|ls|cat|head|tail|git)\b/u.test(text);
  });
}

function summarizeTrace(row) {
  const path = join(root, row.trace);
  if (!existsSync(path)) throw new Error(`missing trace: ${row.trace}`);
  const events = traceEvents(path);
  const serves = events.filter((event) => event.type === 'serve');
  const unknownOutcomes = serves.filter((event) => !servedOutcomes.has(event.outcome) && !missOutcomes.has(event.outcome));
  if (unknownOutcomes.length) fail(`${row.instance} ${row.mode}: unknown serve outcome`);
  const hits = serves.filter((event) => servedOutcomes.has(event.outcome)).length;
  const misses = serves.filter((event) => missOutcomes.has(event.outcome)).length;
  const savedMs = serves.reduce((total, event) => total + (Number(event.savedMs) || 0), 0);
  const seals = events.filter((event) => event.type === 'sandbox_seal');
  const sealLayers = new Set(seals.map((event) => event.layer));
  const resolution = events.filter((event) => event.type === 'resolution');
  if (resolution.length !== 1) fail(`${row.instance} ${row.mode}: resolution event count ${resolution.length}`);
  if (!sealLayers.has('wrapper') || !sealLayers.has('app-server')) {
    fail(`${row.instance} ${row.mode}: incomplete seal ${[...sealLayers].join(',')}`);
  }
  const workspaceEscapes = seals.reduce((total, event) => total + (Number(event.workspaceEscapes) || 0), 0);
  const wrapper = seals.find((event) => event.layer === 'wrapper');
  const workspace = resolve(wrapper?.workspace ?? '');
  const forbidden = wrapper?.forbiddenReadPaths ?? [];
  for (const event of events) {
    if (event.type !== 'codex' || event.what !== 'exec') continue;
    if (commandEscapes(event.command, workspace, forbidden)) {
      flaggedAttempts.push({ instance: row.instance, mode: row.mode, command: event.command });
    }
  }
  const summary = {
    savedMs,
    hits,
    misses,
    serves: hits,
    resolved: resolution[0]?.resolved === true,
    resolutionExitCode: resolution[0]?.exitCode,
    sealed: sealLayers.has('wrapper') && sealLayers.has('app-server'),
    workspaceEscapes,
  };
  for (const field of ['savedMs', 'hits', 'misses', 'resolved', 'resolutionExitCode']) {
    if (row[field] !== summary[field]) fail(`${row.instance} ${row.mode}: row ${field}=${row[field]} trace=${summary[field]}`);
  }
  if (row.failed) fail(`${row.instance} ${row.mode}: failed row`);
  return summary;
}

const byKey = new Map();
for (const row of resultRows) {
  const key = `${row.instance}\0${row.mode}`;
  if (byKey.has(key)) fail(`duplicate result row: ${row.instance} ${row.mode}`);
  byKey.set(key, { row, trace: summarizeTrace(row) });
}

const expectedTraceNames = new Set(resultRows.map((row) => row.trace.split('/').at(-1)));
for (const name of readdirSync(traceRoot)) {
  if (name.endsWith('.jsonl') && !expectedTraceNames.has(name)) fail(`orphan trace: ${name}`);
}

const perInstance = [];
for (const instance of instanceIds) {
  const on = byKey.get(`${instance}\0on`);
  const baseline = byKey.get(`${instance}\0baseline`);
  if (!on || !baseline) {
    fail(`${instance}: missing ${on ? 'baseline' : baseline ? 'on' : 'both'} arm`);
    continue;
  }
  if (baseline.trace.savedMs !== 0 || baseline.trace.hits !== 0 || baseline.trace.misses !== 0) {
    fail(`${instance}: baseline contains speculative serves`);
  }
  perInstance.push({
    instance,
    savedMs: on.trace.savedMs,
    serves: on.trace.serves,
    misses: on.trace.misses,
    onResolved: on.trace.resolved,
    baselineResolved: baseline.trace.resolved,
  });
}

const onRows = perInstance.map((item) => byKey.get(`${item.instance}\0on`).trace);
const baselineRows = perInstance.map((item) => byKey.get(`${item.instance}\0baseline`).trace);
const totals = {
  pairs: perInstance.length,
  rows: resultRows.length,
  savedMs: perInstance.reduce((total, row) => total + row.savedMs, 0),
  hits: perInstance.reduce((total, row) => total + row.serves, 0),
  misses: perInstance.reduce((total, row) => total + row.misses, 0),
  onResolved: perInstance.filter((row) => row.onResolved).length,
  baselineResolved: perInstance.filter((row) => row.baselineResolved).length,
  sealedCells: [...onRows, ...baselineRows].filter((row) => row.sealed).length,
  workspaceEscapes: [...onRows, ...baselineRows].reduce((total, row) => total + row.workspaceEscapes, 0),
  flaggedAttempts: flaggedAttempts.length,
};
totals.serveRate = totals.hits + totals.misses === 0 ? 0 : totals.hits / (totals.hits + totals.misses);

console.log(JSON.stringify({ dataset, totals, perInstance, flaggedAttempts, violations }, null, 2));
if (violations.length) process.exitCode = 1;
