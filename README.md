# spex

Prefetch — speculative tool execution for OpenAI Codex, built as a standalone
`codex app-server` client.

While Codex is still reasoning after a code edit, Prefetch has already run the
verification command it is about to ask for — in Codex's own sandbox — and serves the
finished result the moment the model requests it.

- `schemas/` — generated app-server protocol bindings (codex-cli 0.144.4)
- `data/` — command taxonomy and the transition pattern table the predictor loads
- `documentation/` — implementation plan and CLI UI design
