# ui roadmap · two dashboards

the product has two audiences and gets two faces. same event stream, same daemon, two renderings.

## phase 1 · the instrument (technical dashboard) · CURRENT
the engineer view, chosen from the ui-specs exploration (combo-4-instrument). single sheet on faint graph paper: five lane waterfall on one reconciled timeline (codex reasoning, terminal, edits; one spex lane per kind), FIRED rules with margin timestamps, leader line callouts on serves, the parallel annotation, numbered epoch track with kill markers, per kind matrix, event ledger, gate tally. dense, honest, reads like a profiler. this is the booth screen for anyone who leans in and the screenshot for the readme.

## phase 2 · the user dashboard
the consumer view: what a developer who just wants faster codex sees. principles:
- one number leads: time saved today, huge (borrow from ui-specs/3-focus)
- plain language, no jargon: "your tests ran before codex asked · 3 times today"
- the rajan card (ui-specs/6-rajan) as the embeddable unit: codex activity left, a thin spex actions rail right (held / fired / running early / served), one status word. this card is also what goes in the readme and any web page
- nothing about epochs, doors, or utility. those live in the instrument only
- a single "details" link that opens the instrument for the curious

## phase 3 · the entrance
not a one pager: you enter through an intro page, ramp labs style. like their sites, arrival is an experience before the data.

- landing: the name, one sentence ("it runs your tools before you ask"), a quiet live indicator, and TWO doors:
  - "i want the story" · the non technical path: user dashboard (phase 2), plain language, the big saved number, the rajan card
  - "show me how it works" · the technical path: the instrument sheet (phase 1), waterfall, epochs, gates, ledger
- the chooser IS the design: two large bordered rectangles side by side, lowercase, hover inverts to ink. no nav bar, no marketing
- routes: / = entrance, /story = user view, /instrument = technical sheet. the live pill on the entrance already ticks (connected to the same sse feed) so even the front door proves the thing is alive
- both inner pages get a tiny back link to the entrance and a crosslink to each other ("switch view")
- same style law throughout: white, ink, greys, pastel mint, terracotta, geist only, square corners, no em dashes, all lowercase

## implementation notes
- both read the same sse feed; the user dashboard is a strict subset renderer, no new daemon work
- routes now live in phase 3: / = entrance w/ technical vs non technical chooser, /story = user view, /instrument = the sheet
- keep both to the locked style: geist only, pure white, ink and greys, zero radius, green #afcbb1 and terracotta #e08a6e accents only, no em dashes anywhere in copy
