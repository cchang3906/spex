# Mining pipeline (pre-event, offline — plan §6.2)

Turns public agent trajectories into `data/pattern_table.json` via the taxonomy in
`data/taxonomy.yaml`. Pipeline code here is pre-event research tooling; the artifacts it
produces (`normalized_train.jsonl`, `normalized_validation.jsonl`, `pattern_table.json`)
are the pre-event deliverables.

## 1. Bulk download (human step)

The **swe-bench/experiments** repo lists the submissions and their public S3 trajectory
locations in `metadata.yaml`.

```bash
cd ~/Desktop
git clone --filter=blob:none --no-checkout https://github.com/swe-bench/experiments.git traj-data
cd traj-data

# Discover what's available (submission dirs are named <date>_<system>):
git sparse-checkout init --no-cone
git ls-tree -d --name-only HEAD evaluation/verified/ | less   # also try evaluation/lite/

# Check out the metadata for the selected submissions:
git sparse-checkout set \
  "evaluation/verified/20251127_openhands_claude-opus-4-5" \
  "evaluation/verified/20251215_livesweagent_claude-opus-4-5" \
  "evaluation/verified/20250807_openhands_gpt5" \
  "evaluation/verified/20250524_openhands_claude_4_sonnet" \
  "evaluation/verified/20250522_sweagent_claude-4-sonnet-20250514" \
  "evaluation/verified/20240402_sweagent_gpt4"
git checkout main

# Trajectories live in public S3, not in the Git tree:
for name in \
  20251127_openhands_claude-opus-4-5 \
  20251215_livesweagent_claude-opus-4-5 \
  20250807_openhands_gpt5 \
  20250524_openhands_claude_4_sonnet \
  20250522_sweagent_claude-4-sonnet-20250514 \
  20240402_sweagent_gpt4
do
  uvx --from awscli aws s3 sync \
    "s3://swe-bench-submissions/verified/$name/trajs/" \
    "evaluation/verified/$name/trajs/" \
    --no-sign-request
done

du -sh evaluation/*/*/trajs
```

Selection guidance:
- Prefer names containing `openhands` and `sweagent` / `swe-agent` — both scaffolds have
  parseable public trajectory formats and heavy shell edit→verify loops. 2–3 submissions
  per scaffold, **different models** (pattern priors should generalize across models).
- Expect ~100MB–1GB per submission; target 1–3GB total (thousands of trajectories).
- Skip `agentless`-style submissions (localize+repair pipelines, few shell commands).

When done, tell Claude the path (default assumption: `~/Desktop/traj-data`). Ingest will
symlink or read it as `mining/raw/` (gitignored).

## 2. Normalize (Claude step — `mining/ingest_*.py`, to be written)

Per-scaffold adapters parse raw trajectories into event streams, classify every command
with `mining/normalize.py` (85/85 fixtures green), and emit one JSON object per
trajectory:

```json
{"traj_id": "verified/20250XXX_openhands.../astropy__astropy-12907",
 "scaffold": "openhands", "model": "claude-...",
 "events": ["READ(passed)", "EDIT(py)", "TEST(failed)", "EDIT(py)", "TEST(passed)"]}
```

Split by hash of `traj_id`: 85% → `data/normalized_train.jsonl`, 15% →
`data/normalized_validation.jsonl` (held out from mining entirely).

## 3. Mine + evaluate (Claude step — `mining/mine.py`, `mining/eval.py`)

Suffix counting for k ≤ 3 (plan §6.2): for every suffix of the last-3 window, count
next-event class frequencies; keep patterns with `support ≥ 20` and `p ≥ 0.35`; emit
`data/pattern_table.json`.

Eval on the validation split — **go/no-go gates**:

| metric | definition | gate |
|---|---|---|
| top-3 recall | over validation events whose TRUE next class ∈ {TEST, LINT, TYPECHECK, BUILD}: fraction where that class is among the top-3 predicted candidates (report top-1/top-2 too — runtime uses K=2) | **≥ 40%** |
| executable rate | of all predicted candidates fired, fraction whose class resolves to a runnable argv — operationalized as: an argv of that class was already observed earlier in the same trajectory (simulates the §5.3 learned tier) or is derivable from ecosystem heuristics | **≥ 70%** |

Below-gate fallback (pre-agreed): ship hand-tuned priors seeded from the mined counts +
rely on §6.3 online learning; disclose honestly in the demo ("prior is weak; watch it
learn this session").

## Results (2026-07-15) — **GO on both gates**

Corpus: 2,496 trajectories / 105k events from 5 submissions (sweagent gpt-4 +
claude-4-sonnet, openhands claude-4-sonnet + gpt-5, mini-swe-agent claude-opus-4-5).
The 6th download (`20251127_openhands_claude-opus-4-5`) is EXCLUDED — its export
redacts commands ("Action: unknown"). Split: 2,146 train / 350 validation, hashed by
instance id so no instance straddles both sets.

| metric | result | gate |
|---|---|---|
| top-3 recall (2,766 val events) | **75.4%** | ≥ 40% ✅ |
| executable rate, learned tier only | 94.4% | — |
| executable rate, learned + TEST heuristic | **100%** | ≥ 70% ✅ |
| top-1 recall | 75.4% (table is TEST-dominated; top-1 ≈ top-3) | — |
| per-scaffold top-3 | sweagent 88.5% / openhands 72.3% / mini-swe-agent 57.6% | — |
| EDIT-trigger speculations served before next epoch bump (runtime-shaped, K=2) | 42.2% | — |

`data/pattern_table.json`: 84 patterns (82 TEST, 2 LINT). Mined shapes independently
reproduce the plan §6.2 hypothesized examples: `EDIT(py) → TEST p=0.35 (n=6095)`,
`TEST(failed)|EDIT(py) → TEST p=0.66`, `TEST(passed)|TEST(passed)|EDIT(py) → TEST p=0.81`.

Known limitation (disclose, don't patch): SWE-bench is Python bug-fixing, so
TYPECHECK/BUILD never reached support (5 BUILD events in-corpus) and LINT barely did.
The prior carries TEST; the demo's JS/TYPECHECK beat is carried by §6.3 online
learning — which is the intended narrative ("prior mined from public trajectories,
adaptation live on screen"). Do NOT hand-add fake patterns; that forfeits the
anti-hardcoded answer.

Repro: `python3 mining/ingest.py [raw_root] && python3 mining/mine.py && python3 mining/eval.py`

## Out-of-distribution check: real Codex streams (mining/eval_spike.py)

The mining corpus is SWE-bench agents; the runtime target is Codex. Scoring the mined
table against the actual Codex event streams captured in the spike (phase B trials +
phase G, gpt-5.5/gpt-5.6-sol on the toy repo; updated after the full 21-trial run): **top-2 recall 23/28 (82%)**, post-edit verification recall 100% (23/23).

- Every post-edit verification — the product moment — was predicted, including the
  fix-loop `EDIT(py)|TEST(failed)|EDIT(py) → TEST` and phase G's declined attempt.
- The single miss was the model's FIRST pre-edit repro run (context: pure exploration,
  `READ|GIT_RO|GREP → TEST`). The table abstains there — which is harmless by design:
  no edit yet ⇒ no trigger ⇒ nothing speculated ⇒ vanilla behavior. Abstention ≠ wrong
  speculation. (If desired, exploration-context patterns like `GREP(passed) → TEST`
  sit just below τ in the mined counts; do not lower τ for this — wasted spec costs CPU.)
- n=6 is a sanity check, not a statistic. Every future compliance trial appends more
  Codex streams to documentation/spike/samples/ and this script picks them up — the
  pending 17+ trials double as OOD eval data. The binding performance gate remains M5
  (hit rate ≥ 80% on scripted demo tasks, measured live at the event).
