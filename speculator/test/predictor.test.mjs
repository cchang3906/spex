import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createPredictor } from "../src/predictor.mjs";

const realTable = fileURLToPath(new URL("../../data/pattern_table.json", import.meta.url));

function syntheticTable() {
  const dir = mkdtempSync(join(tmpdir(), "predictor-"));
  const path = join(dir, "table.json");
  writeFileSync(path, JSON.stringify({
    k: 3, minSupport: 20, tau: 0.35,
    patterns: [{ context: ["LINT(passed)"], predicts: "LINT", p: 0.9, support: 50 }]
  }));
  return path;
}

test("table echo: mined pattern returned with its exact p", () => {
  const table = JSON.parse(readFileSync(realTable, "utf8"));
  const pat = table.patterns[0];
  const pred = createPredictor(realTable);
  for (const sig of pat.context) pred.observe(sig);
  const hit = pred.propose().find(c => c.kind === pat.predicts);
  assert.ok(hit);
  assert.equal(hit.p, pat.p);
});

test("backoff: length 1 suffix serves when full context is absent", () => {
  const pred = createPredictor(realTable);
  pred.observe("OTHER(passed)");
  pred.observe("OTHER(passed)");
  pred.observe("EDIT(py)");
  const hit = pred.propose().find(c => c.kind === "TEST");
  assert.ok(hit);
  assert.equal(hit.p, 0.3514);
});

test("blend fix: unseen context reaches 1.0 after one observation", () => {
  const pred = createPredictor(syntheticTable());
  pred.observe("FOO(passed)");
  pred.observe("TEST(passed)");
  pred.observe("FOO(passed)");
  const hit = pred.propose().find(c => c.kind === "TEST");
  assert.ok(hit);
  assert.equal(hit.p, 1);
});

test("blend fix: mined context barely moves after one observation", () => {
  const pred = createPredictor(syntheticTable());
  pred.observe("LINT(passed)");
  pred.observe("READ(passed)");
  pred.observe("LINT(passed)");
  const hit = pred.propose().find(c => c.kind === "LINT");
  assert.ok(hit);
  assert.ok(hit.p < 0.9);
  assert.ok(Math.abs(hit.p - 0.9) < 0.05);
});

test("online counts: contrary observations pull a mined p down", () => {
  const pred = createPredictor(realTable);
  pred.observe("EDIT(py)");
  pred.observe("READ(passed)");
  pred.observe("EDIT(py)");
  const hit = pred.propose().find(c => c.kind === "TEST");
  assert.ok(hit);
  assert.ok(hit.p < 0.3514);
  assert.ok(hit.p > 0);
});
