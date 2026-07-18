import { readFileSync } from "node:fs";
import { createPredictor } from "../src/predictor.mjs";
import { createScheduler } from "../src/scheduler.mjs";
import { createCache } from "../src/cache.mjs";
import { makeClock, makeExecutor, flush, ask } from "./fakes.mjs";

const KINDS = new Set(["TEST", "LINT", "TYPECHECK", "BUILD"]);
const VERIFY_MS = 7000;
const STEP_MS = 3000;
const tablePath = new URL("../../data/pattern_table.json", import.meta.url).pathname;
const lines = readFileSync(new URL("../../data/normalized_validation.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const verifiers = {
  resolve: (kind) => (KINDS.has(kind) ? { argv: ["verify", kind], cwd: "/repo" } : null),
  learn: () => {},
};

function newStats() {
  return {
    trajs: 0, asks: 0, hits: 0, reused: 0, promoted: 0, covered: 0,
    launches: 0, wasted: 0,
    abstains: { executable: 0, policy: 0, confident: 0, budget: 0 },
  };
}

function add(s, t) {
  for (const k of ["trajs", "asks", "hits", "reused", "promoted", "covered", "launches", "wasted"]) s[k] += t[k];
  for (const d of Object.keys(s.abstains)) s.abstains[d] += t.abstains[d];
}

const clock = makeClock();
const overall = newStats();
const byScaffold = {};

for (const traj of lines) {
  const t = newStats();
  t.trajs = 1;
  const executor = makeExecutor(clock, VERIFY_MS);
  let launchedSinceEdit = 0;
  executor.onLaunch = () => launchedSinceEdit++;
  const collect = (e) => {
    if (e.type === "abstain") t.abstains[e.door]++;
    if (e.type === "outcome" && e.outcome === "reused") t.reused++;
    if (e.type === "outcome" && e.outcome === "promoted") t.promoted++;
  };
  const cache = createCache(collect);
  const predictor = createPredictor(tablePath);
  const scheduler = createScheduler({ cache, verifiers, predictor, executor, onEvent: collect });

  for (const ev of traj.events) {
    clock.advance(STEP_MS);
    executor.resolveDue();
    await flush();
    const cls = ev.sig.split("(")[0];
    if (KINDS.has(cls)) {
      t.asks++;
      if (launchedSinceEdit > 0) t.covered++;
      const r = await ask(cache, executor, clock, cls);
      if (r) t.hits++;
      if (ev.raw) verifiers.learn(ev.raw, "/repo");
    }
    predictor.observe(ev.sig);
    if (cls === "EDIT") {
      launchedSinceEdit = 0;
      scheduler.onFileChange();
    }
  }
  t.launches = executor.launches;
  t.wasted = executor.launches - t.reused - t.promoted;
  add(overall, t);
  add((byScaffold[traj.scaffold] ??= newStats()), t);
}

function row(name, s) {
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "n/a");
  return {
    set: name,
    trajs: s.trajs,
    asks: s.asks,
    "hit rate": pct(s.hits, s.asks),
    "trigger cov": pct(s.covered, s.asks),
    reused: s.reused,
    promoted: s.promoted,
    "spec/traj": (s.launches / s.trajs).toFixed(2),
    wasted: s.wasted,
    "ab:exec": s.abstains.executable,
    "ab:policy": s.abstains.policy,
    "ab:conf": s.abstains.confident,
    "ab:budget": s.abstains.budget,
  };
}

console.log("simulate: replay of normalized_validation.jsonl through real predictor + scheduler + cache");
console.log("assumptions: verifiers.resolve faked to a nominal argv for all four kinds (this eval");
console.log("measures prediction and scheduling, not argv resolution); verification duration fixed at");
console.log(`${VERIFY_MS}ms, virtual clock advances ${STEP_MS}ms per event. duration free metrics: trigger`);
console.log("coverage, would be hit rate, abstain breakdown, speculations per trajectory, wasted speculations.");
console.log();
console.table([row("all", overall)]);
console.table(Object.entries(byScaffold).map(([k, s]) => row(k, s)));
