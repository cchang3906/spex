import { readFileSync } from "node:fs";

const W = 20;
const ALLOW = new Set(["TEST", "LINT", "TYPECHECK", "BUILD"]);

export function createPredictor(tablePath) {
  const table = JSON.parse(readFileSync(tablePath, "utf8"));
  const k = table.k;
  const mined = new Map();
  for (const pat of table.patterns) {
    const key = pat.context.join("|");
    if (!mined.has(key)) mined.set(key, {});
    mined.get(key)[pat.predicts] = pat.p;
  }
  const window = [];
  const onlineDenom = new Map();
  const onlineNum = new Map();

  function observe(sigClass) {
    const cls = sigClass.split("(")[0];
    for (let len = 1; len <= Math.min(k, window.length); len++) {
      const key = window.slice(-len).join("|");
      onlineDenom.set(key, (onlineDenom.get(key) || 0) + 1);
      if (ALLOW.has(cls)) {
        const counts = onlineNum.get(key) || {};
        counts[cls] = (counts[cls] || 0) + 1;
        onlineNum.set(key, counts);
      }
    }
    window.push(sigClass);
    if (window.length > k) window.shift();
  }

  function propose() {
    const best = new Map();
    for (let len = Math.min(k, window.length); len >= 1; len--) {
      const key = window.slice(-len).join("|");
      const prior = mined.get(key);
      const den = onlineDenom.get(key) || 0;
      const num = onlineNum.get(key) || {};
      for (const kind of new Set([...Object.keys(prior || {}), ...Object.keys(num)])) {
        const n = num[kind] || 0;
        let p;
        if (prior) p = den ? ((prior[kind] || 0) * W + n) / (W + den) : prior[kind] || 0;
        else p = den ? n / den : 0;
        if (p > (best.get(kind) || 0)) best.set(kind, p);
      }
    }
    return [...best]
      .filter(([, p]) => p > 0)
      .map(([kind, p]) => ({ kind, p }))
      .sort((a, b) => b.p - a.p);
  }

  return { observe, propose };
}
