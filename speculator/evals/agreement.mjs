import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVerifiers } from "../src/verifiers.mjs";

const v = createVerifiers(mkdtempSync(join(tmpdir(), "agree-")));
const lines = readFileSync(new URL("../../data/normalized_validation.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean);

let total = 0;
let agree = 0;
const disagreements = new Map();

for (const line of lines) {
  for (const ev of JSON.parse(line).events) {
    if (ev.cls === undefined || ev.raw === undefined) continue;
    total++;
    const kind = v.classify(ev.raw);
    if (kind === ev.cls) agree++;
    else {
      const key = JSON.stringify([ev.raw, ev.cls, kind]);
      disagreements.set(key, (disagreements.get(key) || 0) + 1);
    }
  }
}

console.log("agreement: real js verifiers.classify vs python miner cls on every event with raw+cls");
console.log(`events compared: ${total}`);
console.log(`agreement rate: ${((100 * agree) / total).toFixed(2)}% (${agree}/${total}, ${total - agree} disagree)`);
console.log();
console.log("top 10 disagreements (count, python cls, js kind, raw):");
const top = [...disagreements].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [key, n] of top) {
  const [raw, cls, kind] = JSON.parse(key);
  console.log(`  ${String(n).padStart(4)}  py=${cls}  js=${kind}  ${raw.length > 100 ? raw.slice(0, 100) + "..." : raw}`);
}
