# ux plan — decluttering the dashboard + two-person split

## 0. the thing to fix first (it's not clutter)

The screenshot shows `wait hidden Σ 0.0s`, `served 0/1`, `1 speculation`. That reads as "the product does nothing." It isn't a rendering bug — it's timing.

Measured from `demo/events-demo.jsonl`:

| | |
|---|---|
| trace span | 36.9s |
| first payoff (promoted, +1.0s saved) | **+18.7s** |
| first real hit (+4.1s saved) | +28.2s |
| total saved across trace | **9.2s** |
| events in trace | 26 |

The replay is real-time paced and loops. So **every loop spends its first 18.7 seconds showing all zeros**, then delivers the whole story in the last 18 seconds, then resets to zeros again. The screenshot was taken at ~+10s — inside the dead zone.

Anyone who glances at this for ten seconds concludes it doesn't work. At a demo table that is most people.

**Fix before touching layout:**
- Seed the counters from the full trace on connect, or start the replay at the first predict rather than at `t₀`
- Compress dead air — the replay already caps gaps at 3000ms; drop to ~600ms
- Persist a "last loop" summary so the reset doesn't wipe the evidence to zero
- On reset, don't zero the hero — cross-fade to the completed totals

This one change does more for perceived quality than any decluttering below.

## 1. the diagnosis: everything is the same size

Nothing on screen is louder than anything else. Counted from the screenshot: 6 metadata cells + 5 header stats + a 10-item key + 3 equal-weight bottom panels + axis labels. ~21 competing elements before a single number is read.

The design doc (`documentation/dashboard.md`) already made the call: *"if we build only one animation, it's this"* — the card crossing the wall. Right now there is no single loudest thing. The pitch is buried in a ledger.

**One rule to apply throughout:** exactly one element is hero, everything else is support or hidden. The hero is **seconds of waiting removed**. Nothing else competes.

## 2. concrete cuts

| element | now | do |
|---|---|---|
| hero stat | 5 equal stats in a row | `wait hidden` at 4–6× size, alone. others become a small support row |
| dwg no. / sheet / rev / session / agent / t₀ | 6 header cells | keep 2 (session, epoch). rest → tooltip or footer. blueprint framing costs a whole band of pixels |
| key/legend | 10 items, always on | collapse to a `?` toggle. legends teach once, then tax forever |
| per-kind matrix | full panel, mostly `·` dashes | inline into hero as one line per kind. it's 1 row of real data in a 300px panel |
| gate tally | full panel, 1 row | fold into the ledger as a filter chip |
| event ledger | 30 raw rows, monospace spew | keep, but demote to a right rail and **collapse EXEC noise** — 7 of 12 visible rows are `$ sed`/`$ pwd`. group as "6 commands" |
| waterfall | 60s window, activity in right 15% | auto-fit window to actual activity. -60s→-30s is empty grid |
| overlapping labels | `$ sed -n '1,250p' AGENTS.md` overprints | truncate + stagger, or drop exec labels below a width threshold |
| rotated `wait hidden Σ` | vertical text, right edge | delete. it duplicates the hero |
| below-the-fold | ~40% empty page | tighten to one screen. no scroll at demo resolution |

**Ledger signal density is the worst offender.** It's the most alive thing on screen and it spends most rows on `pwd` and `sed`. Filter to state changes — EDIT, epoch, PREDICT, fired, served, discarded — and the same panel becomes the narrative instead of a log.

## 3. what's missing entirely

- **No A/B contrast.** Nothing on screen says "vanilla would have taken X, we took Y." That's the entire claim and it isn't visible. A single before/after bar would carry more than the waterfall does.
- **The crossing moment isn't legible.** The design doc's money animation — card crossing the wall into the codex lane — doesn't read in a static frame. If it's implemented, it's too subtle; if it isn't, it's the highest-value build left.
- **No idle state.** Before events arrive it says "waiting for events…" — a wasted opportunity for a one-line explanation of what someone is about to watch.

## 4. two-person split

`src/dashboard.html` is a single 1187-line file. Both of you editing it means constant conflicts. Split by **file ownership**, not by feature:

**Person A — the view** (owns `src/dashboard.html`)
1. Hero restructure + kill the dead zone (§0)
2. Cuts from §2 top to bottom
3. A/B contrast bar
4. Crossing animation polish

**Person B — the evidence** (owns `scripts/bench.mjs`, `demo/`, `mining/`, eval docs)
1. Generate a **better demo trace** — denser, front-loaded payoff, more kinds than just `test` (current trace is 26 events, one kind, and the matrix looks empty because of it)
2. Run the real benchmark, fill §5
3. Own the numbers that land in the doc and the pitch

**The seam is the event schema** — the JSONL contract in `demo/events-demo.jsonl`. Agree on it once, up front, in writing. Then A builds against a fixture and B produces real traces to the same shape, and neither blocks the other. If the schema needs to change, that's a conversation, not a commit.

**Rhythm:** 90-minute blocks, screenshot diff at each boundary. A's work is visually verifiable, so review by looking, not by reading diffs.

**Don't both go to the demo trace.** It's the one shared artifact and it will conflict. B owns it.

## 5. evaluation — numbers pending

To be filled from `node scripts/bench.mjs 1 --swebench` (8 SWE-bench Verified instances, vanilla Codex vs Codex + Spex).

| metric | vanilla | + spex | delta |
|---|---|---|---|
| wall-clock per task | | | |
| wait removed (Σ s) | | | |
| hit rate (served / asked) | | | |
| wasted CPU (Σ s) | | | |
| tokens | | | (expect 0) |
| correctness / resolve rate | | | (expect unchanged) |

Known offline numbers, already claimed in the README — cite these, don't re-derive:
- top-1 and top-3 recall **75.4%** on held-out trajectories (`python3 mining/eval.py`)
- top-2 recall **82%**, post-edit recall **100%** on out-of-distribution sessions (`python3 mining/eval_spike.py`)

Two things to decide when the numbers land:
- **Which single number is the hero.** Probably wall-clock delta — it's the claim a person feels. Pick one and put it in the hero slot.
- **Report wasted CPU honestly and visibly.** The design doc's instinct ("waste is honest") is right and it's a credibility asset, not a liability. Cost that's disclosed reads as rigor.

## 6. order of work

1. **Kill the dead zone** (§0) — highest impact per minute, and it's a handful of lines in `src/dashboard.mjs`
2. **Hero restructure** — one number, 4× size
3. **Cuts** — legend, metadata, gate tally, matrix, ledger filter
4. **A/B contrast bar** — makes the claim visible
5. **Crossing animation** — the pitch moment
6. **Real numbers** into §5

1–3 are most of the perceived quality gain and none of them require new data.

## note on the ui-specs/

`ui-specs/` has 11 standalone mockups on this branch (`1-ledger`, `5-trace`, `combo-4-instrument`, …). Open them directly — `open ui-specs/5-trace.html`, no server needed. Worth 10 minutes together before cutting, since a direction may already be resolved there and re-deciding it live would be wasted time. I haven't reviewed them against the current implementation.
