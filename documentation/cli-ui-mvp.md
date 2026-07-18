# CLI UI — MVP spec (early prototype)

Status: v1 design for the `mentalist` CLI renderer. Locked for the MVP build; expected to be
improved later. Colored mockup (both scenarios below):
https://claude.ai/code/artifact/534843d5-8801-4dca-be58-7fed3daf4020
Builds on the existing renderer in `src/cli.mjs` (sofia/cli); this spec adds to it, it does not
replace the transport/queueing/serve wiring already there.

## Design principles

1. **Two columns, no drawn structure.** Left column is codex, rendered exactly like a plain codex
   session (`•` bullets, `└` output chips, `›` prompt). Everything mentalist does lives in a
   right-aligned annotation column. Concurrency is shown by alignment, not by box-drawing rails.
2. **One accent, one job.** Yellow appears only at the moment a cache is served. Everything
   speculative is grey/dim. Blue is reserved for reclaimed time. Red/green appear only inside
   codex's own test output chips. Nothing else gets color.
3. **Append-only.** No cursor movement, no line rewriting. Every visual mechanic below works in
   scrollback, `script` captures, and CI logs.
4. Textual-inspired: docked footer for status, muted palette, lowercase labels.

## Anatomy

```
› fix the failing test in pricing and verify.

• i'll reproduce the failure first, then patch the pricing logic.

• called prefetch_verify(test)              cold start · ran fresh 4.2s        <grey>
  └ exit 1 · FAILED test_bulk_discount — assert 108.0 == 90.0

• thinking… tier boundary uses > instead of >=
• edited src/pricing.py (+1 −1)             prefetch test(pytest -q) 0.4s…     <grey>
• thinking… verifying before concluding     prefetch test(pytest -q) 3.1s…     <grey>
▌ called prefetch_verify(test)              ⚡ cache hit · 3.1s saved          <yellow row>
  └ exit 1 · FAILED test_bulk_discount_edge — 99.0 != 100.0

• thinking… exactly 100 units must not discount
• edited src/pricing.py (+2 −1)             prefetch test(pytest -q) 0.2s…     <grey>
• thinking…                                 prefetch test(pytest -q) done · cached
▌ called prefetch_verify(test)              ⚡ cache hit · 4.3s saved          <yellow row>
  └ exit 0 · 14 passed in 4.21s

• fixed the tier boundary in src/pricing.py — all 14 tests pass.

────────────────────────────────────────────
 › ▌                                        (input area, blinking cursor)
────────────────────────────────────────────
 ⚡ 2 caches hit · 7.4s saved               (status band: smaller, dim; yellow + blue)
```

- **Header:** term-bar style one-liner — `mentalist — <repo>` left, `<model> · <n> patterns ·
  <verifier argv>` right. No boxed panel.
- **Hit rows:** full-width yellow wash (~9% alpha) + 3px solid yellow left bar. The only loud
  element on screen. Promotion (ask landed mid-run) renders IDENTICALLY to a fresh hit — no
  "(joined)" label in the MVP; only savedMs differs (per learnings #6 the promotion is the common
  shape; the UI does not burden the viewer with the distinction).
- **Status band:** docked under the input separators, smaller type:
  `⚡ N caches hit <yellow> · Xs saved <blue>`. Reset per session, not per turn.

## Annotation column vocabulary

| state | text (right-aligned, grey unless noted) |
|---|---|
| serve miss at epoch 0 | `cold start · ran fresh <dur>` |
| speculation in flight (1 slot) | `prefetch <kind>(<argv>) <elapsed>…` |
| speculation finished | `prefetch <kind>(<argv>) done · cached` |
| multiple slots, spawn moment | one annotation-only line per slot, full argv, stacked under the trigger line |
| multiple slots, cascade | compact join: `test 1.8s… · lint 1.1s… · type 2.2s…` (argv dropped) |
| serve hit / promotion | `⚡ cache hit <yellow> · <savedMs>s saved <blue>` on a highlighted row |
| no verifier resolved | `no verifier for this repo yet` |

**Cascade mechanic (the core trick):** while speculation runs, the renderer never repaints.
Each NEW transcript line gets the current elapsed appended as its annotation, so the running
timer walks down the transcript and freezes in place line by line. Old lines keep their stale
elapsed — that is the feature, not a bug: it reads as a timeline.

## Event → render mapping

| event | render |
|---|---|
| `item/agentMessage/delta` | streamed answer text (already built) |
| `item/reasoning/summaryTextDelta` | `• thinking… <summary>` dim italic (NEW — subscribe; do not opt out at initialize) |
| `codex` edit (router) | `• edited <path> (+a −b)` |
| `item/started`/`completed` commandExecution | `$ <cmd> · exit N · <dur>` chips (already built) |
| `speculate` | spawn annotation (stack if >1 slot) |
| in-flight ticker | timer vs `speculate.t`, appended at next line print |
| `outcome` done | `done · cached` annotation |
| `outcome` discarded | (MVP: not rendered; wasted time appears only in bench numbers) |
| `serve` hit/promoted | highlighted hit row + savedMs; increment session counters |
| `serve` miss | `cold start · ran fresh <dur>` (epoch 0) or `ran fresh <dur>` |
| `serve` unknown | `no verifier for this repo yet` |
| `turn/completed` | refresh status band |
| `abstain`, `predict`, `admit`, `counterfactual`, `tokens` | not rendered in MVP (dashboard's job) |

All events already exist in `src/events.mjs` sinks — no new instrumentation required. New render
work: annotation column (pad-to-width, `ann` right-aligned), reasoning subscription, session
counter fold, hit-row highlight (ANSI bg + left bar glyph `▌`), status band redraw under prompt.

## Colors (ANSI)

| role | color | use |
|---|---|---|
| spec activity / thinking / chips | dim grey (`\x1b[2m` / 256-color 245) | everything speculative |
| cache hit | yellow (`\x1b[33m`) + row wash `▌` bar | serve moment only |
| saved time | blue (`\x1b[34m` / 256-color 110) | savedMs + status band |
| test output | muted red/green | inside codex output chips only |

## Deferred (post-MVP)

- Live spinner/elapsed on the input line (needs safe `\r` on the open line — renderer's `open`
  state already supports it).
- Rendering `outcome: discarded` (wasted seconds) and `abstain` doors — honesty exhibits, but
  dashboard carries them for the demo.
- `counterfactual` display on the observability path.
- Width handling: annotation column currently assumes ≥100-col terminals; degrade by dropping
  argv, then elapsed, then the whole annotation.
- Session vs turn scoping toggle for the status band.
