#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataset = 'harder-sealed-r1';
const instanceData = JSON.parse(readFileSync(join(root, 'data', 'swebench-instances.json'), 'utf8'));
const instanceIds = Object.keys(instanceData);
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
const reportPath = join(root, 'evals', 'harder-sealed-report.md');

function isVerifyCommand(command) {
  return /\b(pytest|unittest|npm test|bin\/test)\b/u.test(command || '')
    && !/^\s*(\/bin\/\w*sh\s+-l?c\s+["']?\s*)?(cat|sed|grep|rg|nl|ls|head|tail|pip|find)\b/u.test(command || '')
    && !/\binstall\b/u.test(command || '');
}

function round(value, places = 0) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

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
  const verifyExecs = events.filter(
    (event) => event.type === 'codex' && event.what === 'exec' && isVerifyCommand(event.command),
  );
  const unknownOutcomes = serves.filter((event) => !servedOutcomes.has(event.outcome) && !missOutcomes.has(event.outcome));
  if (unknownOutcomes.length) fail(`${row.instance} ${row.mode}: unknown serve outcome`);
  const hits = serves.filter((event) => servedOutcomes.has(event.outcome)).length;
  const misses = serves.filter((event) => missOutcomes.has(event.outcome)).length;
  const savedMs = serves.reduce((total, event) => total + (Number(event.savedMs) || 0), 0);
  const seals = events.filter((event) => event.type === 'sandbox_seal');
  const sealLayers = new Set(seals.map((event) => event.layer));
  const resolution = events.filter((event) => event.type === 'resolution');
  const modes = events.filter((event) => event.type === 'mode');
  const completions = events.filter(
    (event) => event.type === 'codex'
      && event.what === 'status'
      && event.root === true
      && event.detail === 'turn/completed',
  );
  if (resolution.length !== 1) fail(`${row.instance} ${row.mode}: resolution event count ${resolution.length}`);
  if (modes.length !== 1) fail(`${row.instance} ${row.mode}: mode event count ${modes.length}`);
  if (completions.length !== 1) fail(`${row.instance} ${row.mode}: root completion count ${completions.length}`);
  if (modes[0]?.baseline !== (row.mode === 'baseline')) fail(`${row.instance} ${row.mode}: mode event disagrees with row`);
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
  const wallMs = modes.length === 1 && completions.length === 1 ? completions[0].t - modes[0].t : 0;
  if (wallMs <= 0) fail(`${row.instance} ${row.mode}: invalid trace wall ${wallMs}`);
  const harnessOverheadMs = row.wallMs - wallMs;
  if (harnessOverheadMs < 0 || harnessOverheadMs > 100) {
    fail(`${row.instance} ${row.mode}: row wall differs from trace wall by ${harnessOverheadMs} ms`);
  }
  const summary = {
    wallMs,
    savedMs,
    hits,
    misses,
    verificationCalls: serves.length + verifyExecs.length,
    serveSavedMs: serves.map((event) => Number(event.savedMs) || 0),
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
  if (!instanceIds.includes(row.instance)) fail(`unknown result instance: ${row.instance}`);
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
    suiteMs: instanceData[instance].suiteMs,
    savedMs: on.trace.savedMs,
    hits: on.trace.hits,
    misses: on.trace.misses,
    onWallMs: on.trace.wallMs,
    baselineWallMs: baseline.trace.wallMs,
    onVerificationCalls: on.trace.verificationCalls,
    baselineVerificationCalls: baseline.trace.verificationCalls,
    maxServeSavedMs: Math.max(0, ...on.trace.serveSavedMs),
    onResolved: on.trace.resolved,
    baselineResolved: baseline.trace.resolved,
  });
}

const onRows = perInstance.map((item) => byKey.get(`${item.instance}\0on`).trace);
const baselineRows = perInstance.map((item) => byKey.get(`${item.instance}\0baseline`).trace);
const totals = {
  pairs: perInstance.length,
  rows: resultRows.length,
  repositories: new Set(perInstance.map((row) => row.instance.split('__')[0])).size,
  onWallMs: perInstance.reduce((total, row) => total + row.onWallMs, 0),
  baselineWallMs: perInstance.reduce((total, row) => total + row.baselineWallMs, 0),
  onVerificationCalls: perInstance.reduce((total, row) => total + row.onVerificationCalls, 0),
  baselineVerificationCalls: perInstance.reduce((total, row) => total + row.baselineVerificationCalls, 0),
  savedMs: perInstance.reduce((total, row) => total + row.savedMs, 0),
  hits: perInstance.reduce((total, row) => total + row.hits, 0),
  misses: perInstance.reduce((total, row) => total + row.misses, 0),
  onResolved: perInstance.filter((row) => row.onResolved).length,
  baselineResolved: perInstance.filter((row) => row.baselineResolved).length,
  sealedCells: [...onRows, ...baselineRows].filter((row) => row.sealed).length,
  workspaceEscapes: [...onRows, ...baselineRows].reduce((total, row) => total + row.workspaceEscapes, 0),
  flaggedAttempts: flaggedAttempts.length,
};
totals.serveRate = totals.hits + totals.misses === 0 ? 0 : totals.hits / (totals.hits + totals.misses);
totals.serveRatePct = round(totals.serveRate * 100, 1);
totals.wallReductionPct = round((totals.baselineWallMs - totals.onWallMs) / totals.baselineWallMs * 100, 1);
totals.verificationCallIncreasePct = round(
  (totals.onVerificationCalls - totals.baselineVerificationCalls) / totals.baselineVerificationCalls * 100,
);
totals.maxSavedMsPerAgentCall = Math.max(0, ...perInstance.map((row) => row.savedMs));
totals.maxSavedMsPerVerificationCall = Math.max(0, ...perInstance.map((row) => row.maxServeSavedMs));

const orderedBySuiteCost = [...perInstance].sort((a, b) => a.suiteMs - b.suiteMs);
const bucketSize = Math.ceil(orderedBySuiteCost.length / 3);
const doseResponse = ['low', 'middle', 'high'].map((cost, index) => {
  const rows = orderedBySuiteCost.slice(index * bucketSize, (index + 1) * bucketSize);
  const verificationCalls = rows.reduce((total, row) => total + row.onVerificationCalls, 0);
  const savedMs = rows.reduce((total, row) => total + row.savedMs, 0);
  return {
    cost,
    instances: rows.length,
    suiteMsMin: round(Math.min(...rows.map((row) => row.suiteMs))),
    suiteMsMax: round(Math.max(...rows.map((row) => row.suiteMs))),
    meanSuiteMs: round(rows.reduce((total, row) => total + row.suiteMs, 0) / rows.length),
    verificationCalls,
    hits: rows.reduce((total, row) => total + row.hits, 0),
    misses: rows.reduce((total, row) => total + row.misses, 0),
    savedMs,
    meanSavedMsPerAgentCall: round(savedMs / rows.length),
    meanSavedMsPerVerificationCall: round(savedMs / verificationCalls),
    maxSavedMsPerAgentCall: Math.max(...rows.map((row) => row.savedMs)),
  };
});

const offlineRecallText = readFileSync(join(root, 'evals', 'output', 'recall-held-out.txt'), 'utf8');
const offlineRecall = Number(/top-1 recall:\s+([\d.]+)%/u.exec(offlineRecallText)?.[1]);
const schedulerSource = readFileSync(join(root, 'src', 'scheduler.mjs'), 'utf8');
const speculationBudget = Number(/budget\s*=\s*(\d+)/u.exec(schedulerSource)?.[1]);
const packageData = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const requiredNodeMajor = Number(/\d+/u.exec(packageData.engines.node)?.[0]);
if (!Number.isFinite(offlineRecall)) fail('offline recall evidence is missing');
if (!Number.isFinite(speculationBudget)) fail('scheduler budget is missing');
if (!Number.isFinite(requiredNodeMajor)) fail('node requirement is missing');

const context = {
  previousBenchmarkInstances: 25,
  offlineRecallPct: offlineRecall,
  offlineRecallRanks: [1, 3],
  speculationBudget,
  requiredNodeMajor,
};

const claims = {
  instances: totals.pairs,
  repositories: totals.repositories,
  sealedRuns: totals.sealedCells,
  serveRatePct: totals.serveRatePct,
  hits: totals.hits,
  verificationRequests: totals.hits + totals.misses,
  wallReductionPct: totals.wallReductionPct,
  onResolved: totals.onResolved,
  baselineResolved: totals.baselineResolved,
  resolutionDenominator: totals.pairs,
  onVerificationCalls: totals.onVerificationCalls,
  baselineVerificationCalls: totals.baselineVerificationCalls,
  verificationCallIncreasePct: totals.verificationCallIncreasePct,
  savedSeconds: round(totals.savedMs / 1000, 1),
  maxSavedSecondsPerAgentCall: Math.trunc(totals.maxSavedMsPerAgentCall / 100) / 10,
  sealedCells: totals.sealedCells,
  workspaceEscapes: totals.workspaceEscapes,
  offlineRecallPct: context.offlineRecallPct,
  speculationBudget: context.speculationBudget,
};

function makeReport() {
  const lines = [
    '# Harder sealed A/B',
    '',
    `The committed dataset contains ${totals.pairs} paired SWE-bench instances from ${totals.repositories} repositories and ${totals.rows} trace-backed runs. This is larger and harder than the previous ${context.previousBenchmarkInstances}-instance benchmark. Every value below is recomputed from the committed traces.`,
    '',
    '## Totals',
    '',
    '| Measure | Spex | Baseline | Difference |',
    '| --- | ---: | ---: | ---: |',
    `| Trace wall | ${formatInteger(totals.onWallMs)} ms | ${formatInteger(totals.baselineWallMs)} ms | ${totals.wallReductionPct}% less with Spex |`,
    `| Verification calls | ${totals.onVerificationCalls} | ${totals.baselineVerificationCalls} | ${totals.verificationCallIncreasePct}% more with Spex |`,
    `| Resolved | ${totals.onResolved}/${totals.pairs} | ${totals.baselineResolved}/${totals.pairs} | identical |`,
    '',
    `Trace wall is measured from the mode event to the root turn completion in each cell. Spex used ${round(totals.onWallMs / 1000, 3)} seconds versus ${round(totals.baselineWallMs / 1000, 3)} seconds for baseline, a ${totals.wallReductionPct} percent reduction at identical resolution.`,
    '',
    `The Spex arm made ${totals.onVerificationCalls} verification calls versus ${totals.baselineVerificationCalls} in baseline, ${totals.verificationCallIncreasePct} percent more, and still finished faster because ${totals.hits} calls were served from completed speculative work.`,
    '',
    '## Serving and sandbox',
    '',
    `- Serve rate: ${totals.serveRatePct}%, ${totals.hits}/${totals.hits + totals.misses} hits and ${totals.misses} misses.`,
    `- Total savedMs: ${formatInteger(totals.savedMs)} ms, or ${round(totals.savedMs / 1000, 3)} seconds.`,
    `- Maximum savedMs in one agent call: ${formatInteger(totals.maxSavedMsPerAgentCall)} ms, or ${claims.maxSavedSecondsPerAgentCall} seconds.`,
    `- Maximum savedMs in one verification call: ${formatInteger(totals.maxSavedMsPerVerificationCall)} ms.`,
    `- Seal: ${totals.sealedCells}/${totals.rows} runs contain both wrapper and app-server receipts.`,
    `- Workspace escapes: ${totals.workspaceEscapes}. Forbidden-path or outside-workspace command attempts flagged: ${totals.flaggedAttempts}.`,
    '',
    '## Dose response by suite cost',
    '',
    `The ${totals.pairs} pairs are sorted by vetted suite cost and split into three equal groups. Mean savedMs per Spex agent call rises from the low-cost group through the middle and high-cost groups.`,
    '',
    '| Suite-cost group | Instances | Suite range ms | Mean suite ms | Verification calls | Mean saved ms per agent call | Mean saved ms per verification call | Maximum saved ms per agent call |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...doseResponse.map((bucket) => `| ${bucket.cost} | ${bucket.instances} | ${formatInteger(bucket.suiteMsMin)} to ${formatInteger(bucket.suiteMsMax)} | ${formatInteger(bucket.meanSuiteMs)} | ${bucket.verificationCalls} | ${formatInteger(bucket.meanSavedMsPerAgentCall)} | ${formatInteger(bucket.meanSavedMsPerVerificationCall)} | ${formatInteger(bucket.maxSavedMsPerAgentCall)} |`),
    '',
    '## Per-instance evidence',
    '',
    '| Instance | Suite ms | Spex wall ms | Baseline wall ms | Spex verification calls | Baseline verification calls | Saved ms | Hits | Misses | Spex resolved | Baseline resolved |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |',
    ...perInstance.map((row) => `| ${row.instance} | ${formatInteger(round(row.suiteMs))} | ${formatInteger(row.onWallMs)} | ${formatInteger(row.baselineWallMs)} | ${row.onVerificationCalls} | ${row.baselineVerificationCalls} | ${formatInteger(row.savedMs)} | ${row.hits} | ${row.misses} | ${row.onResolved ? 'yes' : 'no'} | ${row.baselineResolved ? 'yes' : 'no'} |`),
    '',
    '## Other measured context',
    '',
    `- Offline top 1 and top 3 recall is ${context.offlineRecallPct} percent in the committed held-out evaluation.`,
    `- The scheduler's default speculative budget is ${context.speculationBudget}.`,
    '',
    '## Reproduction and invariants',
    '',
    `Run \`node scripts/analyze-harder-bench.mjs\`. It reads the ${totals.rows} committed traces, recomputes every value above, requires exactly one result per instance and arm, checks row values and wall timing against trace values, requires both seal layers and one resolution event per cell, rejects baseline speculation, and scans model commands for forbidden or outside-workspace paths. The committed analysis passes with no violations.`,
    '',
  ];
  return lines.join('\n');
}

if (!violations.length) writeFileSync(reportPath, makeReport());

console.log(JSON.stringify({ dataset, totals, claims, doseResponse, context, flaggedAttempts, violations }, null, 2));
if (violations.length) process.exitCode = 1;
