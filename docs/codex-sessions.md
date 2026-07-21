# Codex sessions

Each numbered specification was handled as its own Codex working session with an acceptance gate before the next specification. The same `/feedback` ID appears across the rows because the work stayed in one persistent build thread. This log records workflow metadata only.

| Date | Specification | `/feedback` session ID | Work completed |
| --- | --- | --- | --- |
| 2026-07-19 | 01 protocol client | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | App-server stdio transport, normalized events, scoped exec approvals, dynamic tools, JSONL runner, and process cleanup |
| 2026-07-20 | 02 verifier resolution | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Seeded and declared resolution, conservative command classification, and learned exec persistence |
| 2026-07-20 | 03 trajectory mining | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Public trajectory normalization, suffix pattern mining, benchmark exclusions, and held-out evaluation receipts |
| 2026-07-20 | 04 predictor | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Constant-time suffix lookup, context tracking, confidence gating, and benchmark table enforcement |
| 2026-07-20 | 05 scheduler | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Expected-value admission, bounded preemption, epoch relaunch, cooldown, cold start, and byte-preserving execution |
| 2026-07-20 | 06 cache and serve | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Single-credit cache accounting, epoch-checked promotion, authoritative serving, TTL fencing, byte hashing, and counterfactual detection |
| 2026-07-20 | 07 tool and convention | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Pull-only tool registration, AGENTS convention generation, baseline isolation, interactive CLI, and cross-layer delivery fencing |
| 2026-07-20 | 08 subagents | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Canonical workspace daemon, ancestry-checked session registry, shared epoch and cache, mutation barriers, cross-session accounting, and live fan-out demo |
| 2026-07-20 | 09 test suite | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Deterministic cache, serve, scheduler, verifier, predictor, transport, and subagent tests, two opt-in live integrations, mutation validation, and the repository check gate |
| 2026-07-20 | 10 benchmark harness | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Deterministic SWE-bench sourcing and vetting, offline repo generation, paired arms, resolution gates, recomputable traces, and control acceptance |
| 2026-07-20 | 11 data analysis | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Trace-recomputed reporting, row and promotion invariants, live prediction accuracy, variance and workspace disclosures, and corrupt-row rejection |
| 2026-07-20 | 10 contamination controls | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Per-cell filesystem and network jail for model commands and verifier processes, boot probes, trace receipts, and deterministic randomized arm order |
| 2026-07-20 | 10 command-match validation | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Exact seeded reproduce-first convention plus tool-call and resolved-command fields in serve traces |
| 2026-07-20 | 12 readme and Codex log | `019f7cb8-6204-7c63-a1c3-60e3bc93d0bf` | Merged sealed benchmark artifacts, trace-recomputed headline metrics, submission readme, and fresh-clone command acceptance |
