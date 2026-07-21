#!/usr/bin/env node
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCellSandbox } from '../src/cell-sandbox.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.env.PYTHONHASHSEED ??= '3741209606';
const dry = process.argv.includes('--dry');
const swebench = process.argv.includes('--swebench');
const args = process.argv.slice(2).filter((a) => a !== '--dry' && a !== '--swebench');
const rounds = Number(args[0] ?? 3);
const task = args[1] ?? 'Fix the failing test in this repo and verify your fix.';
const timeoutMs = swebench ? 900000 : 180000;
const instanceTable = join(root, 'data', 'swebench-instances.json');
const instances = swebench
  ? Object.entries(JSON.parse(readFileSync(instanceTable, 'utf8'))).filter(([, r]) => r.verify).filter(([id]) => !process.env.SPEX_ONLY || id === process.env.SPEX_ONLY)
  : [[null, null]];
const modes = process.env.SPEX_BASELINE === '1' ? ['baseline'] : ['on'];
const resultsFile = join(root, 'bench-results.jsonl');
const completed = new Set();
if (existsSync(resultsFile)) {
  for (const line of readFileSync(resultsFile, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (row.dataset === 'harder-sealed-r1' && !row.failed && row.trace && existsSync(join(root, row.trace))) {
        completed.add(`${row.round}\0${row.instance}\0${row.mode}`);
      }
    } catch {}
  }
}
const suffix = (row) => ' First reproduce the failure by running: ' + row.verify + ' . Then fix the issue by editing the source files, and verify your fix by running the same command before finishing. The project virtualenv is at .venv; use ./.venv/bin/python for all python commands.';

let current = null;
let currentSandbox = null;
function killGroup(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}
process.on('SIGINT', () => {
  if (current) killGroup(current);
  currentSandbox?.cleanup();
  process.exit(130);
});

function verifierArgv(row) {
  const command = String(row?.verify ?? '').trim();
  const argv = JSON.parse(execFileSync('python3', [
    '-c',
    'import json, shlex, sys; print(json.dumps(shlex.split(sys.argv[1])))',
    command,
  ], { encoding: 'utf8' }));
  if (!argv.length) throw new Error('benchmark instance has no verifier command');
  return argv;
}

function runSealed(sandbox, argv, cwd, timeout = 120000) {
  const launch = sandbox.wrapExecution(argv, cwd);
  const result = spawnSync(launch.argv[0], launch.argv.slice(1), {
    cwd: launch.cwd,
    env: launch.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  if (result.error) throw result.error;
  if (!Number.isInteger(result.status) || result.status === 126) {
    throw new Error(`sealed verifier did not reach a real exit code: ${result.status ?? result.signal}`);
  }
  return {
    exitCode: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const fake = `
const fs = require('node:fs');
fs.mkdirSync('.prefetch', { recursive: true });
const base = process.env.SPEX_BASELINE === '1';
const evts = base
  ? [{ type: 'mode', baseline: true }, { type: 'codex', what: 'done', command: 'python3 -m unittest', exitCode: 0, durationMs: 5200 }]
  : [
      { type: 'mode', baseline: false },
      { type: 'speculate', kind: 'test' },
      { type: 'serve', kind: 'test', outcome: 'hit', savedMs: 4100 },
      { type: 'serve', kind: 'test', outcome: 'promoted', savedMs: 900 },
      { type: 'serve', kind: 'lint', outcome: 'miss', savedMs: 0 },
      { type: 'outcome', kind: 'test', outcome: 'discarded', savedMs: 0, wastedMs: 700 },
    ];
for (const e of evts) {
  const line = JSON.stringify({ t: Date.now(), ...e });
  fs.appendFileSync('.prefetch/events.jsonl', line + '\\n');
  console.log(line);
}
setTimeout(() => console.log(JSON.stringify({ t: Date.now(), type: 'codex', what: 'status', detail: 'turn/completed' })), base ? 120 : 60);
setTimeout(() => {}, 5000);
`;

function aggregate(file) {
  const s = { savedMs: 0, hits: 0, misses: 0, speculations: 0, wastedMs: 0, tokens: 0, verifyStallMs: 0, toolWaits: [], sealed: 0, sealLayers: [], workspaceEscapes: 0 };
  const text = readFileSync(file, 'utf8');
  const pending = new Map();
  const sealLayers = new Set();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const isVerifyCmd = (c) => /\b(pytest|unittest|npm test|bin\/test)\b/.test(c || '') && !/^\s*(\/bin\/\w*sh\s+-l?c\s+["']?\s*)?(cat|sed|grep|rg|nl|ls|head|tail|pip|find)\b/.test(c || '') && !/\binstall\b/.test(c || '');
    if (e.type === 'codex' && e.what === 'exec' && isVerifyCmd(e.command)) pending.set(e.command, e.t);
    if (e.type === 'codex' && e.what === 'done' && pending.has(e.command)) {
      const stall = Math.max(0, e.t - pending.get(e.command));
      s.verifyStallMs += stall;
      s.toolWaits.push(stall);
      pending.delete(e.command);
    }
    if (e.type === 'serve') {
      if (['hit', 'reused', 'promoted', 'joined'].includes(e.outcome)) s.hits += 1;
      else s.misses += 1;
      s.savedMs += e.savedMs || 0;
      if (typeof e.waitMs === 'number') {
        s.toolWaits.push(e.waitMs);
        s.verifyStallMs += e.waitMs;
      }
    } else if (e.type === 'speculate') s.speculations += 1;
    else if (e.type === 'outcome') s.wastedMs += e.wastedMs || 0;
    else if (e.type === 'tokens') s.tokens = Math.max(s.tokens, e.total || 0);
    else if (e.type === 'sandbox_seal') {
      sealLayers.add(e.layer);
      s.workspaceEscapes += e.workspaceEscapes || 0;
    }
  }
  s.sealLayers = [...sealLayers].sort();
  s.sealed = sealLayers.has('wrapper') && sealLayers.has('app-server') ? 1 : 0;
  return s;
}

async function runOne(round, mode, inst, row) {
  const dir = mkdtempSync(join(tmpdir(), 'spex-bench-'));
  let sandbox = null;
  try {
    if (inst) execFileSync('bash', [join(root, 'scripts/swebench-repo.sh'), inst, dir, ...(mode === 'baseline' ? ['--baseline'] : [])], { stdio: 'ignore' });
    else execFileSync('bash', [join(root, 'scripts/make-demo-repo.sh'), dir, ...(mode === 'baseline' ? ['--baseline'] : [])], { stdio: 'ignore' });
    sandbox = createCellSandbox({
      repoDir: dir,
      forbiddenReadPaths: [
        process.env.SWB_CACHE ?? join(homedir(), '.cache', 'spex-swb'),
        join(root, '..', 'data'),
        join(root, 'data'),
        join(tmpdir(), 'tp.diff'),
      ],
    });
    currentSandbox = sandbox;
    const seal = await sandbox.verifyWrappedExecution();
    appendFileSync(join(dir, '.prefetch', 'events.jsonl'), JSON.stringify({
      t: Date.now(),
      type: 'sandbox_seal',
      layer: 'wrapper',
      permissionProfile: sandbox.profile,
      workspace: dir,
      probes: seal,
      forbiddenReadPaths: sandbox.forbiddenReadPaths,
      forbiddenReadsBlocked: sandbox.forbiddenReadPaths.length,
      workspaceEscapes: 0,
    }) + '\n');
    if (inst) {
      const preflight = runSealed(sandbox, verifierArgv(row), dir);
      if (preflight.exitCode !== 1) throw new Error(`${inst} verifier reached unexpected pre-fix exit ${preflight.exitCode}`);
      const detail = preflight.output.trim().split('\n').at(-1) ?? '';
      console.log(`  sealed verifier exit=${preflight.exitCode}${detail ? ` · ${detail}` : ''}`);
    }
  } catch (error) {
    sandbox?.cleanup();
    if (currentSandbox === sandbox) currentSandbox = null;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    throw error;
  }
  const runTask = inst ? row.problem_statement + suffix(row) : task;
  const env = { ...sandbox.appServerEnvironment };
  delete env.NODE_OPTIONS;
  delete env.SPEX_DASH;
  delete env.SPEX_BASELINE;
  if (mode === 'baseline') env.SPEX_BASELINE = '1';
  env.SPEX_FORBIDDEN_READ_PATHS = JSON.stringify(sandbox.forbiddenReadPaths);
  env.PYTHONHASHSEED = process.env.PYTHONHASHSEED;
  env.SPEX_MODEL = process.env.SPEX_MODEL ?? 'gpt-5.6-sol';
  if (inst) env.SPEX_TABLE = join(root, '..', 'data', 'pattern_table_bench.json');
  const argv = dry ? ['-e', fake] : [join(root, 'src/main.mjs'), dir, runTask];
  const t0 = Date.now();
  const child = spawn(process.execPath, argv, { cwd: dir, env, detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  current = child;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (failed) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const wallMs = Date.now() - t0;
      killGroup(child);
      current = null;
      try {
        let resolved = null;
        let resolutionExitCode = null;
        if (inst) {
          const f2p = readFileSync(join(dir, '.prefetch', 'f2p'), 'utf8');
          const testFiles = f2p.split(/\s+/).filter((t) => t.endsWith('.py'));
          if (testFiles.length) execFileSync('git', ['-C', dir, 'checkout', 'HEAD', '--', ...testFiles], { stdio: 'ignore' });
          const gate = runSealed(sandbox, verifierArgv(row), dir);
          resolutionExitCode = gate.exitCode;
          if (![0, 1].includes(resolutionExitCode)) {
            throw new Error(`${inst} resolution verifier reached unexpected exit ${resolutionExitCode}`);
          }
          resolved = resolutionExitCode === 0;
        }
        const eventsFile = join(dir, '.prefetch', 'events.jsonl');
        appendFileSync(eventsFile, JSON.stringify({
          t: Date.now(),
          type: 'resolution',
          instance: inst ?? 'demo',
          mode,
          exitCode: resolutionExitCode,
          resolved,
        }) + '\n');
        const traceDir = join(root, 'bench-runs', 'harder-sealed-r1');
        mkdirSync(traceDir, { recursive: true });
        const traceFile = join(traceDir, `r${round}-${(inst ?? 'demo').replace(/[^a-z0-9-]/gi, '_')}-${mode}.jsonl`);
        copyFileSync(eventsFile, traceFile);
        const resultRow = { round, mode, instance: inst ?? 'demo', dataset: 'harder-sealed-r1', wallMs, resolved, resolutionExitCode, trace: traceFile.slice(root.length + 1), ...aggregate(eventsFile), failed, codexVersion };
        resolve(resultRow);
      } catch (error) {
        reject(error);
      } finally {
        sandbox.cleanup();
        if (currentSandbox === sandbox) currentSandbox = null;
        try { rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch { /* straggler processes; leftover dir is harmless */ }
      }
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'codex' && e.what === 'status' && e.root === true && String(e.detail).includes('turn/completed')) finish(false);
      }
    });
    child.on('exit', () => finish(true));
    child.on('error', () => finish(true));
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function p95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function report(results) {
  const rows = ['on', 'baseline'].map((mode) => {
    const rs = results.filter((r) => r.mode === mode);
    const ok = rs.filter((r) => !r.failed);
    const solved = ok.filter((r) => r.resolved);
    return {
      mode,
      runs: rs.length,
      failed: rs.length - ok.length,
      resolved: solved.length,
      medianWallMs: Math.round(median(solved.map((r) => r.wallMs))) || 0,
      medianTokens: Math.round(median(solved.map((r) => r.tokens || 0))) || 0,
      verifyStallMs: ok.reduce((a, r) => a + (r.verifyStallMs || 0), 0),
      meanSavedMs: Math.round(mean(ok.map((r) => r.savedMs))),
      hits: ok.reduce((a, r) => a + r.hits, 0),
      misses: ok.reduce((a, r) => a + r.misses, 0),
      speculations: ok.reduce((a, r) => a + r.speculations, 0),
      wastedMs: ok.reduce((a, r) => a + r.wastedMs, 0),
      toolWaitP50: Math.round(median(ok.flatMap((r) => r.toolWaits || []))) || 0,
      toolWaitP95: Math.round(p95(ok.flatMap((r) => r.toolWaits || []))) || 0,
    };
  });
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const fmt = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
  console.log('\n' + fmt(cols));
  for (const r of rows) console.log(fmt(cols.map((c) => r[c])));
  const [on, base] = rows;
  if (on.resolved > 0 && base.resolved > 0) {
    const pct = ((base.medianWallMs - on.medianWallMs) / base.medianWallMs) * 100;
    console.log(`\nwall clock: on is ${pct.toFixed(1)}% faster than baseline (median ${on.medianWallMs}ms vs ${base.medianWallMs}ms, resolved runs only, n=${on.resolved}+${base.resolved})`);
  } else {
    console.log('\nwall clock: insufficient resolved runs for a comparison');
  }
  console.log(`verification wait hidden per run: ${on.meanSavedMs}ms`);
  if (on.medianTokens && base.medianTokens) {
    const td = ((on.medianTokens - base.medianTokens) / base.medianTokens) * 100;
    console.log(`tokens: median ${on.medianTokens} on vs ${base.medianTokens} baseline (${td >= 0 ? '+' : ''}${td.toFixed(1)}%)`);
  }
}

let codexVersion = '';
try { codexVersion = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(); } catch {}
console.log(`codex version: ${codexVersion || 'unknown'}`);

const results = [];
for (let round = 1; round <= rounds; round++) {
  // sequential on purpose: runs share the machine and the model account
  for (const [inst, row] of instances) {
    for (const mode of modes) {
      const key = `${round}\0${inst ?? 'demo'}\0${mode}`;
      if (completed.has(key)) {
        console.log(`round ${round} ${inst ?? 'demo'} ${mode} already complete; skipping`);
        continue;
      }
      console.log(`round ${round} ${inst ?? 'demo'} ${mode}${dry ? ' (dry)' : ''} ...`);
      const r = await runOne(round, mode, inst, row);
      appendFileSync(resultsFile, JSON.stringify(r) + '\n');
      completed.add(key);
      results.push(r);
      console.log(`  wall ${r.wallMs}ms saved ${r.savedMs}ms hits ${r.hits} failed ${r.failed}`);
    }
  }
}
report(results);
process.exit(0);
