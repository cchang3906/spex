# Harder sealed A/B

The committed dataset contains 42 paired harder instances and 84 trace-backed cells. The Spex arm was run with `node scripts/bench.mjs 1 --swebench`; the baseline arm was run with `SPEX_BASELINE=1 node scripts/bench.mjs 1 --swebench`.

## Totals

- Total saved: 44,592 ms.
- Hits: 88. Misses: 22. Serve rate: 80.0%.
- Resolution: 38/42 Spex and 38/42 baseline.
- Seal: 84/84 cells contain both wrapper and app-server receipts.
- Workspace escapes: 0. Forbidden-path or outside-workspace command attempts flagged: 0.

## Per-instance results

| Instance | Saved ms | Serves | Misses | Spex resolved | Baseline resolved |
| --- | ---: | ---: | ---: | :---: | :---: |
| pydata__xarray-6992 | 2,843 | 2 | 2 | yes | yes |
| sphinx-doc__sphinx-7590 | 735 | 2 | 1 | yes | yes |
| sympy__sympy-13878 | 2,703 | 2 | 0 | yes | yes |
| django__django-10554 | 564 | 2 | 0 | yes | yes |
| django__django-11138 | 640 | 3 | 0 | yes | yes |
| django__django-11400 | 669 | 2 | 0 | yes | yes |
| django__django-11885 | 455 | 2 | 0 | yes | yes |
| django__django-12325 | 378 | 2 | 0 | yes | yes |
| django__django-12708 | 466 | 2 | 0 | yes | yes |
| django__django-13128 | 440 | 2 | 0 | yes | yes |
| django__django-13212 | 404 | 2 | 1 | yes | yes |
| django__django-13344 | 427 | 2 | 0 | yes | yes |
| django__django-13449 | 546 | 2 | 0 | yes | yes |
| django__django-13837 | 419 | 2 | 0 | yes | yes |
| django__django-14007 | 453 | 2 | 1 | yes | yes |
| django__django-14011 | 429 | 2 | 0 | no | no |
| django__django-14631 | 486 | 2 | 1 | yes | yes |
| django__django-15128 | 594 | 2 | 1 | yes | yes |
| django__django-15268 | 444 | 2 | 0 | yes | yes |
| django__django-15503 | 499 | 2 | 0 | yes | yes |
| django__django-15629 | 1,716 | 3 | 4 | yes | yes |
| django__django-15957 | 480 | 2 | 1 | yes | yes |
| django__django-16263 | 405 | 2 | 2 | yes | yes |
| django__django-16560 | 605 | 3 | 0 | yes | yes |
| django__django-16631 | 438 | 2 | 1 | yes | yes |
| pydata__xarray-3993 | 1,582 | 2 | 0 | yes | yes |
| pylint-dev__pylint-4551 | 506 | 2 | 0 | yes | yes |
| pylint-dev__pylint-8898 | 379 | 2 | 0 | yes | yes |
| pytest-dev__pytest-10356 | 245 | 2 | 0 | yes | yes |
| pytest-dev__pytest-5787 | 350 | 2 | 0 | yes | yes |
| pytest-dev__pytest-6197 | 388 | 2 | 0 | yes | yes |
| scikit-learn__scikit-learn-25102 | 980 | 1 | 1 | yes | yes |
| sphinx-doc__sphinx-11510 | 556 | 2 | 1 | yes | yes |
| sphinx-doc__sphinx-8548 | 605 | 2 | 0 | yes | yes |
| sphinx-doc__sphinx-9229 | 620 | 2 | 1 | no | no |
| sphinx-doc__sphinx-9461 | 693 | 2 | 0 | yes | yes |
| sympy__sympy-12489 | 691 | 2 | 1 | yes | yes |
| sympy__sympy-13852 | 654 | 2 | 0 | yes | yes |
| sympy__sympy-14248 | 6,664 | 3 | 1 | no | no |
| sympy__sympy-16597 | 6,462 | 3 | 2 | yes | yes |
| sympy__sympy-17630 | 1,025 | 2 | 0 | yes | yes |
| sympy__sympy-18199 | 3,954 | 2 | 0 | no | no |

## Reproduction and invariants

Run `node scripts/analyze-harder-bench.mjs`. It reads the 84 committed traces, recomputes every value above, requires exactly one result per instance and arm, checks row values against trace values, requires both seal layers and one resolution event per cell, rejects baseline speculation, and scans model commands for forbidden or outside-workspace paths. The committed analysis passes with no violations.
