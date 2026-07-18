import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const dir = process.argv[2] ?? 'bench-runs';
const outDir = join(dir, 'formatted');

function fmtT(ms) {
  return `+${(ms / 1000).toFixed(2)}s`;
}

function fmtDur(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function detail(e) {
  switch (e.type) {
    case 'mode':
      return e.baseline ? 'baseline, speculation off' : 'spex on';
    case 'predict':
      return `${e.kind ?? ''} p=${e.p?.toFixed?.(2) ?? e.p ?? '?'}`;
    case 'abstain':
      return `${e.kind ?? ''} ${e.reason ?? ''}`.trim();
    case 'admit':
      return `${e.kind ?? ''} p=${e.p?.toFixed?.(2) ?? e.p ?? '?'} epoch=${e.epoch ?? '?'}`;
    case 'speculate':
      return `${e.kind ?? ''} launched${e.argv ? ` (${[].concat(e.argv).join(' ')})` : ''}`;
    case 'serve':
      return `${e.kind ?? ''} ${e.outcome}, saved ${fmtDur(e.savedMs ?? 0)}${typeof e.waitMs === 'number' ? `, model waited ${fmtDur(e.waitMs)}` : ''}`;
    case 'outcome':
      return `${e.kind ?? ''} ${e.outcome}, saved ${fmtDur(e.savedMs ?? 0)}, wasted ${fmtDur(e.wastedMs ?? 0)}`;
    case 'counterfactual':
      return `${e.kind ?? ''} was ready in cache but codex ran it in the terminal`;
    case 'tokens':
      return `total ${e.total ?? '?'}`;
    case 'codex':
      return `${e.what ?? ''} ${e.command ?? e.text ?? ''}`.trim().slice(0, 120);
    case 'reset':
      return `epoch ${e.epoch ?? '?'}, cache cleared for new edits`;
    case 'warn':
      return e.message ?? JSON.stringify(e);
    default:
      return JSON.stringify({ ...e, type: undefined, t: undefined });
  }
}

function formatOne(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch {}
  }
  if (events.length === 0) return null;
  const t0 = events[0].t;
  const name = basename(file, '.jsonl');

  const totals = { hits: 0, misses: 0, savedMs: 0, wastedMs: 0, speculations: 0, tokens: 0, waits: [] };
  for (const e of events) {
    if (e.type === 'serve') {
      if (e.outcome === 'hit' || e.outcome === 'promoted') totals.hits += 1;
      else totals.misses += 1;
      totals.savedMs += e.savedMs || 0;
      if (typeof e.waitMs === 'number') totals.waits.push(e.waitMs);
    } else if (e.type === 'speculate') totals.speculations += 1;
    else if (e.type === 'outcome') totals.wastedMs += e.wastedMs || 0;
    else if (e.type === 'tokens') totals.tokens = Math.max(totals.tokens, e.total || 0);
  }
  const span = events[events.length - 1].t - t0;

  const rows = events.map((e) => `| ${fmtT(e.t - t0)} | ${e.type} | ${detail(e).replace(/\|/g, '\\|')} |`);

  const md = [
    `# trace: ${name}`,
    '',
    `duration ${fmtDur(span)}, speculations ${totals.speculations}, served ${totals.hits}, misses ${totals.misses}, saved ${fmtDur(totals.savedMs)}, wasted ${fmtDur(totals.wastedMs)}, tokens ${totals.tokens}`,
    '',
    '| time | event | detail |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  return { name, md, totals, span };
}

mkdirSync(outDir, { recursive: true });
const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
const index = [];
for (const f of files) {
  const r = formatOne(join(dir, f));
  if (!r) continue;
  writeFileSync(join(outDir, `${r.name}.md`), r.md);
  index.push(r);
  console.log(`formatted ${r.name} (${r.md.split('\n').length} lines)`);
}
if (index.length === 0) console.log('no traces found in ' + dir);
