import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCache } from '../src/cache.mjs';
import { createVerifiers } from '../src/verifiers.mjs';
import { createPredictor } from '../src/predictor.mjs';
import { createScheduler } from '../src/scheduler.mjs';
import { createServe } from '../src/serve.mjs';
import { createRouter } from '../src/router.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node test/replay.mjs documentation/spike/samples/phaseB.jsonl');
  process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 1);
}

const tablePath = fileURLToPath(new URL('../../data/pattern_table.json', import.meta.url));
const lines = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter((e) => e && typeof e.msg === 'object' && e.msg);

let exceptions = 0;
process.on('unhandledRejection', () => exceptions++);
process.on('uncaughtException', () => exceptions++);

let vnow = 0;
Date.now = () => vnow;
const pending = [];
const flush = () => new Promise((r) => setImmediate(r));

async function advance(t) {
  for (;;) {
    let next = null;
    for (const j of pending) if (!j.dead && (!next || j.due < next.due)) next = j;
    if (!next || next.due > t) break;
    vnow = next.due;
    pending.splice(pending.indexOf(next), 1);
    next.fire();
    await flush();
  }
  if (t > vnow && Number.isFinite(t)) vnow = t;
  await flush();
}

const stats = { outcomes: {}, abstains: {}, serves: {}, savedMs: 0, sessions: 0 };
function emit(e) {
  if (e.type === 'outcome') stats.outcomes[e.outcome] = (stats.outcomes[e.outcome] || 0) + 1;
  else if (e.type === 'abstain') stats.abstains[e.door] = (stats.abstains[e.door] || 0) + 1;
  else if (e.type === 'serve') {
    stats.serves[e.outcome] = (stats.serves[e.outcome] || 0) + 1;
    stats.savedMs += e.savedMs || 0;
  }
}

const recsPerSession = [];
for (const e of lines) {
  if (e.dir !== 'out') continue;
  if (e.msg.method === 'initialize') recsPerSession.push([]);
  else if (e.msg.result?.contentItems && recsPerSession.length) {
    const text = e.msg.result.contentItems.map((c) => c.text ?? '').join(' ');
    const d = /duration: ([\d.]+)s/.exec(text);
    const x = /exit code: (\d+)/.exec(text);
    if (d || x)
      recsPerSession[recsPerSession.length - 1].push({
        durationMs: d ? Math.round(parseFloat(d[1]) * 1000) : 1500,
        exitCode: x ? Number(x[1]) : 0,
      });
  }
}

const classifier = createVerifiers('/nonexistent-replay-repo');

function newSession(recs) {
  stats.sessions++;
  const session = { cwd: '/repo', recs };
  const executor = {
    execute() {
      const rec = session.recs.shift() ?? { durationMs: 1500, exitCode: 0 };
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      const job = {
        due: vnow + rec.durationMs,
        fire: () => resolve({ exitCode: rec.exitCode, output: 'replayed verifier output\n', durationMs: rec.durationMs }),
      };
      pending.push(job);
      return { promise, terminate: () => (job.dead = true) };
    },
  };
  const cache = createCache(emit);
  const predictor = createPredictor(tablePath);
  const verifiers = {
    classify: (cmd) => classifier.classify(cmd),
    learn() {},
    resolve: (kind) =>
      String(kind).toUpperCase() === 'TEST'
        ? { argv: ['python3', '-m', 'unittest', 'discover'], cwd: session.cwd }
        : null,
  };
  const serve = createServe({ cache, verifiers, executor, onEvent: emit });
  const scheduler = createScheduler({
    cache,
    verifiers,
    predictor: { propose: () => predictor.propose().map(({ kind, p }) => ({ kind: kind.toLowerCase(), p })) },
    executor,
    onEvent: emit,
    allow: ['test', 'lint', 'typecheck', 'build'],
  });
  let handler;
  createRouter({
    scheduler,
    serve,
    predictor,
    verifiers,
    transport: { respond() {}, onMessage: (h) => (handler = h) },
    emit,
  });
  session.dispatch = (msg) => handler(msg);
  return session;
}

let session = null;
let si = 0;
for (const e of lines) {
  await advance(Date.parse(e.t));
  if (e.dir === 'out') {
    if (e.msg.method === 'initialize') session = newSession(recsPerSession[si++] ?? []);
    else if (e.msg.method === 'thread/start') session.cwd = e.msg.params?.cwd ?? session.cwd;
    continue;
  }
  if (session) {
    session.dispatch(e.msg);
    await flush();
  }
}
await advance(Infinity);

const row = (label, obj, keys) => console.log(label.padEnd(16) + keys.map((k) => `${k}=${obj[k] || 0}`).join('  '));
console.log('replay of', file);
row('outcomes', stats.outcomes, ['reused', 'promoted', 'discarded', 'preempted']);
row('serves', stats.serves, ['hit', 'promoted', 'miss', 'unknown']);
console.log('abstains'.padEnd(16) + (Object.entries(stats.abstains).map(([k, v]) => `${k}=${v}`).join('  ') || 'none'));
console.log('total savedMs'.padEnd(16) + Math.round(stats.savedMs));
console.log('sessions'.padEnd(16) + stats.sessions);
console.log('exceptions'.padEnd(16) + exceptions);
process.exitCode = exceptions ? 1 : 0;
