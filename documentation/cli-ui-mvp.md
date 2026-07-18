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
- **Hit rows:** full-width olive wash (ANSI bg 256-color 58, painted to the line edge via
  `\x1b[K`) + yellow `▌` left bar + right-aligned `⚡ cache hit · Xs saved`. Color codes inside
  the row are fg-only (`\x1b[39m` resets) so the background survives to the edge. The only loud
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
| `ready` (added in cache.mjs for this UI) | `done · cached` annotation, shown once then quiet |
| `outcome` discarded | (MVP: not rendered; wasted time appears only in bench numbers) |
| `serve` hit/promoted | highlighted hit row + savedMs; increment session counters |
| `serve` miss | `cold start · ran fresh <dur>` (epoch 0) or `ran fresh <dur>` |
| `serve` unknown | `no verifier for this repo yet` |
| `turn/completed` | refresh status band |
| `abstain`, `predict`, `admit`, `counterfactual`, `tokens` | not rendered in MVP (dashboard's job) |

All events except `ready` already existed in `src/events.mjs` sinks; `ready` (speculation
finished, result cached, not yet asked for) was added in `cache.mjs` during implementation —
the cache previously went silent between run completion and serve. New render work: annotation
column (pad-to-width, right-aligned), reasoning subscription, session counter fold, hit-row
left bar glyph `▌` (ANSI bg wash dropped — background colors are unreliable across terminal
themes; the bar + yellow/blue annotation carry the highlight), status band above the prompt
(true under-input docking needs cursor repositioning — deferred with the live spinner).

## Colors (ANSI)

| role | color | use |
|---|---|---|
| spec activity / thinking / chips | dim grey (`\x1b[2m` / 256-color 245) | everything speculative |
| cache hit | yellow (`\x1b[33m`) + row wash `▌` bar | serve moment only |
| saved time | blue (`\x1b[34m` / 256-color 110) | savedMs + status band |
| test output | muted red/green | inside codex output chips only |

## v1.1 — codex-mirror pass (implemented)

- Clear screen on load (TTY only) + codex-style boxed header: `>_ spex (v0.1.0)` title row,
  blank row, `model:` / `directory:` rows with `~` substitution.
- Input area mirrors codex's block: blank line, full-width lit input band (256-color 236
  background painted via `\x1b[K`, dim placeholder when empty), dropdown rows beneath, then a
  status row — `model · path` dim on the left, `⚡ N caches hit · Xs saved` right-aligned. The
  old separator-line footer is gone; the status row is the footer.
- Command chips mirror vanilla codex: status-colored bullet (green `•` exit 0, red on failure —
  the bullet alone carries pass/fail, no exit text), bold `Ran`, then the command
  syntax-highlighted shell-style: command-position words blue (git/npm/docker/… keep their
  subcommand blue too), flags and redirects red, args/operators default. Long commands wrap
  under a dim `│` bar (max 2 visual rows, then `… +N lines`). Output lines dim under `└`.
  Chips render at item/completed only — the bullet color needs the exit code, and the Working
  line covers the running phase. A failed command with no output falls back to `└ exit N`.
  prefetch_verify miss rows get the same status-colored bullet (hit rows keep the washed `▌`
  treatment). Message blocks get dim `•` bullets with bright text and a dim rule between
  consecutive blocks.
- Edited cells show the actual diff, codex-style: header `• Edited <path> (+a −b)` with dim
  bullet, bold `Edited`, green `+a` / red `−b` counts — then the diff body with dim line
  numbers (context rows carry the new-file number, removals the old, additions the new),
  removed rows washed dark red (bg 52) and added rows washed dark green (bg 22) painted to
  EOL, context rows dim. Capped at 8 rows then `… +N lines`; first changed file only in the
  MVP. The multi-slot speculation spawn stack still rides the header row.
- Codex block spacing: one blank line between every block (message bullets, thinking lines,
  chips, edited/called rows, rules). Sub-lines stay tight under their parent: `└` output and
  multi-slot annotation stacks. Blank separator lines never carry annotations — the cascade
  rides the block lines themselves.
- Slash-command dropdown under the prompt (raw-mode keypress editor): live prefix filter,
  ↑/↓ select, Tab complete, Enter run, Esc clear. Codex-style rows: name column (padded),
  selected row bold, others dim; blank line between the band and the menu. Unknown `/x` warns
  instead of reaching the model.
- Command palette mirrors codex 0.144.6 (researched from the binary + live app-server probes),
  in codex's order with codex's verbatim descriptions. Dropdown is a scrolling 8-row window
  (selection stays visible; short terminals don't overflow). Wired for real:
  - `/model` (two-step picker), `/fast` (toggles `serviceTier: 'priority'` turn override),
    `/permissions` (picker over `permissionProfile/list` — `:read-only`/`:workspace`/
    `:danger-full-access` with codex's Read Only/Default/Full Access names+descriptions; sets
    the `permissionProfile` turn override), `/experimental` (picker over
    `experimentalFeature/list` filtered to `underDevelopment`; toggle via
    `experimentalFeature/enablement/set {name, enablement:{enabled}}` — writes config.toml,
    same as codex), `/review` (picker of codex's four `ReviewTarget`s — uncommittedChanges /
    baseBranch (branch sub-picker from git) / commit (sub-picker from `git log --oneline`) /
    custom (next typed line becomes the instructions) → `review/start {threadId, target,
    delivery:'inline'}`), `/rename <name>` (`thread/name/set`), `/archive`
    (`thread/archive` + exit), `/delete` (Proceed/Go back confirm picker → `thread/delete` +
    exit), `/skills` (`skills/list`, prints enabled skills), `/hooks` (`hooks/list`), `/new`,
    `/init`, `/compact`, `/diff`, `/status` (now shows effort, permissions, fast mode),
    `/usage`, `/clear`, `/quit`/`/exit`.
  - Honest fallbacks (single dim line, no pretending): `/ide`, `/keymap` (prints spex's fixed
    keys), `/vim`, `/approve`, `/memories`, `/import` — these configure codex's own TUI or
    local state spex doesn't own.
  - A slash command submitted while the prompt is hidden (previous command still running) is
    deferred and auto-submitted when the prompt returns — not dropped.
  - Known gotcha (observed live): a `review/start` turn executed its commands in the
    app-server process's cwd, not the thread cwd — keep spex launched from the demo repo.
- Commands with a selection flow open codex-style select lists, not arg parsing. Generic picker
  (`prompt.pick`): dim-bordered full-width panel, bold title, dim subtitle, numbered rows with a
  `›` cursor (selected row bold, others dim, `(current)` marker, aligned description column),
  dim footer `Press enter to confirm or esc to go back`. Keys: ↑/↓, digit jump, enter confirm,
  esc back. Cursor hidden while open; panel repaints in place and clears fully on close.
  `/model` is the two-step codex flow: `Select Model and Effort` (models + descriptions from
  `model/list` — nothing hardcoded) → `Select Reasoning Level for <model>` (per-model
  `supportedReasoningEfforts`, default preselected); esc on step 2 returns to step 1; confirm
  sets turn overrides and prints codex's `• Model changed to <model> <effort>` history line.
  `/model <name> [effort]` still works as a direct-arg escape hatch. Among the implemented
  palette only `/model` has a picker in codex; `/usage`'s reset-redemption flow is surfaced
  read-only ("N usage limit resets available") — redeeming mutates the account, so spex doesn't.
- Submitted prompts echo as a padded lit band block — band-colored blank row above and below
  the `› text` row (codex pads the highlight) — with a blank line after. The live input band
  gets the same one-row padding above and below.
- The turn's final answer is bracketed by full-width dim rules when earlier blocks (commands,
  edits, tool calls) preceded it in the turn — codex pads the final output with rules. A turn
  whose only block is the message stays bare; rules between consecutive message blocks are now
  full-width too (previously capped at 48 cols).
- Live `• Working (Ns · esc to interrupt)` line while a turn runs: the word is bold with a
  smooth shimmer — a graduated brightness wave (256-color grey ramp peaking near-white) that
  slides across the text in half-character steps at an 80ms tick, sliding fully off before
  re-entering. Suffix stays dim. Redrawn only between blocks (never over an open line),
  cleared before any transcript write. Esc during a turn sends `turn/interrupt`. The shimmer is driven
  by `turn/started`/`turn/completed`, so server-initiated turns — `/compact` and `/review` —
  get it too (verified live during a real review turn: shimmer painted between command chips
  and cleared before every transcript write).
- Status row (footer): docked directly under the band — no blank separator line (codex).
  Left side in codex colors: `model effort` and the absolute repo path in green with a dim `·`
  (no `~` substitution). Cache stats (`⚡ N caches hit · Xs saved`, yellow/blue) right-aligned
  to the terminal edge; on terminals too narrow to fit both, they fall back to a dim `·` join
  on the same line.
- The Working line gets a blank padding row above it (codex); the clear sequence removes both
  rows so the transcript resumes exactly where it left off.
- Streamed message text word-wraps at the terminal edge with a 2-space hanging indent —
  continuation lines align under the bullet text instead of snapping to column 0. Partial
  words split across stream deltas are held and reassembled so words never break mid-wrap.
- Command chips show up to 4 output lines aligned under `└` (continuations indented to match),
  then a dim `… +N lines` truncation notice — codex's multi-line output shape. prefetch_verify
  calls render the same way: `└ exit N · <first output line>` then the real output tail
  (parsed from after the `--- output (tail) ---` marker in the tool result), so the cached
  result shows the same content codex would have seen from running the command itself.
- Status row model text is dark yellow (256-color 136); path stays green.
- Real protocol shapes verified against spike captures: `item/completed` delivers
  `{type:'dynamicToolCall', tool, arguments:{kind}, contentItems:[{type:'inputText', text}]}`
  and `{type:'fileChange', changes:[{path, diff}]}` — exactly what the renderer consumes. A
  live session with no edits and no verify calls emits only speculate/ready at session start,
  so annotations and hit rows are absent by design in trivial chat turns.
- **Append-only exception, scoped:** cursor control (`\r`, `\x1b[0J`, cursor-up) is used ONLY
  inside the input area for the dropdown; the transcript above remains append-only. Non-TTY
  stdin falls back to plain readline (no clear, no dropdown) so pipes and CI captures work.
- **Window resize:** two defenses. Prevention — every painted UI row (band, menu, status,
  picker) is clamped to the current width via ANSI-aware `clip()`, and long input shows its
  tail, so our rows never wrap out of the cursor-up math. Repair — a debounced (60ms)
  `resize` listener clears the live input area wrap-aware (physical height estimated from
  the width recorded at paint time: the input row's painted visible length, `lines × per`
  for the picker) and repaints everything at the new width; a visible Working line is
  cleared and repainted by its next tick. Transcript rows above are static and reflow
  harmlessly.

## Deferred (post-MVP)

- Live spinner/elapsed on the input line (needs safe `\r` on the open line — renderer's `open`
  state already supports it).
- Rendering `outcome: discarded` (wasted seconds) and `abstain` doors — honesty exhibits, but
  dashboard carries them for the demo.
- `counterfactual` display on the observability path.
- Width handling: annotation column currently assumes ≥100-col terminals; degrade by dropping
  argv, then elapsed, then the whole annotation.
- Session vs turn scoping toggle for the status band.
