# CONTEXT.md · mentalist instrument dashboard

You are porting this dashboard UI into a new repo. **Read `dashboard.html` end to end before writing anything.** It is the source of truth. This file tells you what it is, how it runs, and what the rules are.

## what this package contains

```
dashboard.html            the entire UI · 1187 lines · inline <style> + inline IIFE <script> · no deps, no build
dashboard.mjs             ~65-line node http server: serves the page, streams SSE at /events, replays JSONL on a loop
events-demo.jsonl         26-event sample trace, real capture, enough to exercise every render path
reference/ui-roadmap.md   three-phase product plan · CONTEXT ONLY, do not build phases 2 and 3
reference/ux-plan.md      a critique of the current UI · CONTEXT ONLY, do not apply it
reference/ui-specs/       three standalone mockups: combo-4-instrument (the chosen direction),
                          6-rajan (embeddable card), 3-focus (big-number hero treatment)
```

## run it

```bash
node dashboard.mjs events-demo.jsonl
# → http://127.0.0.1:7777
```

Verified working: page returns 200 (48621 bytes), SSE emits the trace in real time, loops forever with a `reset` event between passes. No install step, no dependencies, node 20+.

The mockups in `reference/ui-specs/` are standalone — `open reference/ui-specs/combo-4-instrument.html`, no server needed.

## what the product is

A sidecar that watches a coding agent (codex) and speculatively runs its tests *before* it asks for them. When the agent finally asks, the answer is already cached. The dashboard is the instrument panel proving this happens: a live waterfall showing agent activity on top, speculation lanes below, and the moment a speculation gets *served* into the agent's request.

The single number that matters is **wait hidden** — seconds of waiting removed. Everything else is supporting evidence, including the honestly-reported **wasted** CPU from speculations that got discarded.

## the style law (non-negotiable)

- **font:** Geist only, weights 400/500/600, for both sans and mono roles (`--mono` is also Geist, falling back to SF Mono/Menlo/Consolas). Base font-size 12px.
- **color:** pure white `#ffffff` background. Ink `#0a0a0a`. Greys `--g1 #6b6b6b`, `--g2 #9b9b9b`, `--g3 #ececec`, `--grid #f4f4f4`. Exactly two accents: mint `#bfe3c8` and terracotta `#e08a6e`. Nothing else.
- **zero radius everywhere.** Enforced by `* { border-radius: 0 !important; }`. Keep that line.
- **all copy lowercase. no em dashes anywhere** — `·` (middle dot) is the universal separator.
- **graph-paper body:** four stacked linear-gradients, 64px major grid in `--g3` over 8px minor grid in `--grid`.
- **registration marks:** `+` glyphs at the four sheet corners, offset outside the border. The drafting/blueprint framing is deliberate.
- **borders, never shadows.** There is not one shadow in this design. Structure is 1px hairlines: `--g3` internal, `--ink` structural.

## structure, top to bottom

1. **`.sheet`** — max-width 1344px, centered, 24px padding, 1px `--g3` border, transparent fill so the graph paper shows through.
2. **top strip** (`.strip`, 1px ink border, white fill, flex row with `--g3` dividers):
   - `.s-brand` 216px — name at 20px/600/-0.02em over a 9px mono grey subtitle.
   - `.s-meta` 368px — 4×2 grid of drafting-title-block cells: 7px key tracked `0.12em` in grey, 10px mono ink value. Keys: dwg no., date, rev, sheet, session, agent, t₀, span.
   - `.s-stats` flex-1 — five inline stats: 7px tracked key, 17px/600 value with a 10px grey `<small>` suffix, 24×3px underline. `.hi` underline green; `.warn` value and underline terracotta.
   - `.s-turns` 264px — stacked per-turn cells, each with a green fill bar anchored bottom-left whose width encodes that turn's hidden wait.
3. **legend** — one 9px mono row of chip+label pairs with a bottom hairline. Chips are 12×9px marks: solid `--g3` (reasoning), solid `--g2` (terminal), 2×11px terracotta (edit), 45° green hatch (speculating), solid ink (served), grey with strikethrough (discarded), white with dashed grey border (abstain), 2×11px ink (fired), terracotta `×` (epoch kill). Connection status right-aligned in the same row.
4. **waterfall** — the centerpiece. `.wgrid` is a `152px 1fr 40px` grid: right-aligned lane labels, the scrolling plot, then a right margin holding a `-90deg` rotated annotation with a bracket.
   - geometry: 60000ms window, 36px top margin band, 48px per lane.
   - lanes: three fixed codex lanes (reasoning, terminal, edits) plus one mentalist lane created dynamically per speculation kind. A new kind appends a label, a row hairline, and grows the container.
   - x-mapping: `x = (t - origin) * k` where `k = (nowX - 4) / 60000`, `nowX = width - 12`. Now is a dashed vertical near the right edge; everything scrolls leftward past it.
   - gridlines and axis ticks every 5s, axis labels every 15s.
   - bars: `.reason` 18px grey block · `.term` 16px darker block · `.spec` green 45° hatch with a white-backed inline label · `.served` solid ink, white text · `.discard` grey with a strikethrough pseudo-element · `.abstain` white with a dashed border. Edits are 2px terracotta ticks 24px tall with a small label.
   - **fire events** draw a 1px ink rule from the margin band down through every lane, with a timestamp and rotated label in the margin.
   - **serves** draw a dotted leader line from the bar out to a dotted-border callout pinned to the right edge. This is the money moment — it must read.
   - a `pause`/`follow` button top-right of the plot; paused inverts to ink-on-white. Wheel over the plot scrubs back through history.
   - empty state: centered 10px tracked grey `waiting for events…`.
5. **epoch track** — below the axis, bordered segments in a row, current epoch filled green. Kill markers are terracotta `×` on white with terracotta labels below.
6. **bottom row** — `1fr 1.4fr 1.15fr`, 24px gap, each panel a 1px `#ececec` box with 14/16px padding, collapsing to one column under 1120px:
   - **per-kind matrix** — kind / spec / served / hidden / wasted. 8px tracked `th` with ink bottom border, 10.5px mono `td` with `--g3` hairlines, numerics right-aligned.
   - **event ledger** — 240px max-height scroll. Rows are a `14px 60px 64px 1fr` grid: 6px square colour mark (ink / green / terracotta / hollow outline), timestamp, tracked event key, ellipsis-truncated detail.
   - **gate tally** — gate / door / n, same table styling.
7. **footer** — 9px mono, space-between, with a double-bordered stamp on the right: outer 1px ink, inner 1px `--g3`, holding a status dot (grey → green when live), session name, epoch, connection word.

## the data contract

The page opens `new EventSource('/events')` and renders one JSON object per message. It is a **pure renderer** — no fetching, no state beyond what the stream provides.

```
{t, type:"codex", what:"status", detail:{type:"active"|"turn/completed"|"idle"}}
{t, type:"codex", what:"exec",   command}
{t, type:"codex", what:"done",   command, durationMs, exitCode}
{t, type:"codex", what:"edit",   path, sig}
{t, type:"predict",   candidates:[{kind, p}]}
{t, type:"admit",     kind, argv}
{t, type:"speculate", kind, epoch, argv}
{t, type:"abstain",   kind, door}
{t, type:"serve",     kind, epoch, outcome:"hit"|"promoted"|"miss", savedMs}
{t, type:"outcome",   kind, epoch, outcome:"discarded"|"preempted", wastedMs}
{t, type:"tokens",    total}
{t, type:"reset"}
```

Semantics to preserve:

- `speculate` opens a hatched bar and draws a fire rule through all lanes.
- `serve` with `hit`/`promoted` closes that bar to solid ink and fires a callout — `served · hid Xs` for a hit, `promoted · lead Xs` for a mid-run attach. `miss` only writes a ledger row.
- `outcome` `discarded`/`preempted` closes the bar to struck-through grey and queues a terracotta `×` on the epoch track.
- any event carrying a new `epoch` advances the epoch track.
- `reset` zeroes all counters and writes a RESET ledger row.

`dashboard.mjs` replays the JSONL in real time with inter-event gaps capped at 3000ms, keeps a 500-line backlog so late joiners see history, and loops with a `reset` between passes.

## your task

Reproduce this at pixel-level fidelity in the target repo — same layout, same type scale, same borders, same colors, same motion. Do not redesign. Do not substitute a component library. If you think something is wrong, **say so in your summary and build it as-is anyway**.

### acceptance

- Run the server against `events-demo.jsonl` and screenshot the page at 1440px wide. Screenshot the reference the same way. Iterate until they match.
- Let the trace run a full loop and confirm every path renders: hatched speculation, ink serve with callout, struck-through discard, epoch kill `×`, turn cells filling.
- Confirm `prefers-reduced-motion` is honored (the script reads it at boot).
- No new dependencies. No build step. Stays one HTML file unless told otherwise.

### scope fence

`reference/ui-roadmap.md` describes two further phases — a plain-language user dashboard at `/story` and an entrance chooser at `/`. `reference/ux-plan.md` argues the current UI is too flat and should collapse to one hero number. **Build neither.** Read both so you understand intent, then build phase 1 — the instrument sheet — exactly as it exists today. Report when done; the human decides what comes next.

## known quirks, don't "fix" them

- `dashboard.mjs` has a `/fonts/` route reading from `../demo/`. **No font files exist in the source repo** — the route is vestigial and always 404s. `dashboard.html` loads Geist from the Google Fonts CDN instead. If the target repo needs offline fonts, that is a deliberate decision to raise, not a silent change.
- The replay loops from `t₀`, and the sample trace's first payoff lands ~18.7s in. Every loop therefore opens with ~19 seconds of zeros before anything happens. This is a real problem — `reference/ux-plan.md` §0 diagnoses it — but it is **out of scope for the port**. Match current behavior.
- The `.tl-follow` pause button and wheel-scrub share timeline state; test them together, not separately.
