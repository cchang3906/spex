import { createScheduler } from "../src/scheduler.mjs";
import { createCache } from "../src/cache.mjs";
import { makeClock, makeExecutor, flush, ask } from "./fakes.mjs";

const SEED = 20260717;
const SEQUENCES = 10000;
const BUDGET = 2;
const KINDS = ["TEST", "LINT", "TYPECHECK", "BUILD"];
const ALLOWED = new Set(["reused", "promoted", "discarded", "preempted"]);
const TTL_MS = 600000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const violations = [];
const rejections = [];
process.on("unhandledRejection", (e) => rejections.push(String(e)));
let maxConcurrent = 0;
let outcomes = 0;
let launches = 0;
const byOutcome = { reused: 0, promoted: 0, discarded: 0, preempted: 0 };

const clock = makeClock();

for (let seq = 0; seq < SEQUENCES && violations.length < 10; seq++) {
  const executor = makeExecutor(clock, 1000 + Math.floor(rand() * 9000));
  const verifiers = { resolve: (kind) => ({ argv: ["verify", kind], cwd: "/repo" }) };
  const predictor = {
    propose: () =>
      Array.from({ length: Math.floor(rand() * 4) }, () => ({
        kind: pick([...KINDS, "OTHER"]),
        p: rand(),
      })),
  };
  const bad = (msg) => violations.push(`seq ${seq}: ${msg}`);
  const cache = createCache((e) => {
    if (e.type !== "outcome") return;
    outcomes++;
    if (!ALLOWED.has(e.outcome)) bad(`illegal outcome ${e.outcome}`);
    else byOutcome[e.outcome]++;
    if ((e.outcome === "reused" || e.outcome === "promoted") && e.epoch !== cache.epoch())
      bad(`served epoch ${e.epoch} at current epoch ${cache.epoch()}`);
  });
  const scheduler = createScheduler({ cache, verifiers, predictor, executor, onEvent: () => {}, budget: BUDGET });
  const checkBudget = () => {
    const n = executor.running().filter((j) => !j.promoted).length;
    if (n > maxConcurrent) maxConcurrent = n;
    if (n > BUDGET) bad(`budget exceeded: ${n} speculative jobs running`);
  };
  executor.onLaunch = checkBudget;

  const ops = 5 + Math.floor(rand() * 25);
  for (let i = 0; i < ops; i++) {
    const op = rand();
    if (op < 0.3) {
      clock.advance(Math.floor(rand() * 6000));
      executor.resolveDue();
      await flush();
    } else if (op < 0.6) {
      scheduler.onFileChange();
    } else if (op < 0.75) {
      scheduler.onAuthoritativeCommandStart();
    } else if (op < 0.95) {
      await ask(cache, executor, clock, pick(KINDS));
    } else {
      cache.sweep(clock.now());
    }
    checkBudget();
    await flush();
  }

  cache.bumpEpoch();
  clock.advance(TTL_MS + 1);
  executor.resolveDue();
  await flush();
  cache.sweep(clock.now());
  await flush();
  launches += executor.launches;
  const dangling = executor.jobs.filter((j) => !j.done).length;
  if (dangling) bad(`${dangling} jobs never resolved`);
}

await flush();
if (outcomes !== launches) violations.push(`outcome count ${outcomes} != launch count ${launches}: some job settled zero or twice`);
if (rejections.length) violations.push(`unhandled rejections: ${rejections.slice(0, 3).join("; ")}`);

console.log(`invariants: ${SEQUENCES} random sequences through real scheduler + cache, seed ${SEED}`);
console.log(`launches: ${launches}, outcomes: ${outcomes} (each job settled exactly once: ${outcomes === launches ? "yes" : "NO"})`);
console.log(`outcomes by type: ${JSON.stringify(byOutcome)} (only allowed types: ${outcomes === Object.values(byOutcome).reduce((a, b) => a + b, 0) ? "yes" : "NO"})`);
console.log(`max speculative concurrency observed: ${maxConcurrent} (budget ${BUDGET})`);
console.log(`stale serves: ${violations.some((v) => v.includes("served epoch")) ? "FOUND" : "none"}`);
console.log(`unhandled rejections: ${rejections.length}`);
console.log(violations.length ? `FAIL\n${violations.join("\n")}` : "PASS: all invariants held");
process.exit(violations.length ? 1 : 0);
