# Harder sealed A/B

The committed dataset contains 42 paired SWE-bench instances from 7 repositories and 84 trace-backed runs. This is larger and harder than the previous 25-instance benchmark. Every value below is recomputed from the committed traces.

## Totals

| Measure | Spex | Baseline | Difference |
| --- | ---: | ---: | ---: |
| Trace wall | 2,338,733 ms | 2,715,988 ms | 13.9% less with Spex |
| Verification calls | 110 | 67 | 64% more with Spex |
| Resolved | 38/42 | 38/42 | identical |

Trace wall is measured from the mode event to the root turn completion in each cell. Spex used 2338.733 seconds versus 2715.988 seconds for baseline, a 13.9 percent reduction at identical resolution.

The Spex arm made 110 verification calls versus 67 in baseline, 64 percent more, and still finished faster because 88 calls were served from completed speculative work.

## Serving and sandbox

- Serve rate: 80%, 88/110 hits and 22 misses.
- Total savedMs: 44,592 ms, or 44.592 seconds.
- Maximum savedMs in one agent call: 6,664 ms, or 6.6 seconds.
- Maximum savedMs in one verification call: 3,198 ms.
- Seal: 84/84 runs contain both wrapper and app-server receipts.
- Workspace escapes: 0. Forbidden-path or outside-workspace command attempts flagged: 0.

## Dose response by suite cost

The 42 pairs are sorted by vetted suite cost and split into three equal groups. Mean savedMs per Spex agent call rises from the low-cost group through the middle and high-cost groups.

| Suite-cost group | Instances | Suite range ms | Mean suite ms | Verification calls | Mean saved ms per agent call | Mean saved ms per verification call | Maximum saved ms per agent call |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| low | 14 | 220 to 488 | 415 | 34 | 418 | 172 | 605 |
| middle | 14 | 490 to 806 | 560 | 34 | 565 | 233 | 735 |
| high | 14 | 827 to 37,952 | 7,548 | 42 | 2,202 | 734 | 6,664 |

## Per-instance evidence

| Instance | Suite ms | Spex wall ms | Baseline wall ms | Spex verification calls | Baseline verification calls | Saved ms | Hits | Misses | Spex resolved | Baseline resolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |
| pydata__xarray-6992 | 14,168 | 104,046 | 99,721 | 4 | 4 | 2,843 | 2 | 2 | yes | yes |
| sphinx-doc__sphinx-7590 | 806 | 63,788 | 63,570 | 3 | 3 | 735 | 2 | 1 | yes | yes |
| sympy__sympy-13878 | 6,284 | 148,709 | 86,981 | 2 | 5 | 2,703 | 2 | 0 | yes | yes |
| django__django-10554 | 559 | 72,106 | 78,922 | 2 | 0 | 564 | 2 | 0 | yes | yes |
| django__django-11138 | 491 | 68,399 | 79,547 | 3 | 0 | 640 | 3 | 0 | yes | yes |
| django__django-11400 | 619 | 29,432 | 32,886 | 2 | 0 | 669 | 2 | 0 | yes | yes |
| django__django-11885 | 470 | 26,832 | 50,530 | 2 | 0 | 455 | 2 | 0 | yes | yes |
| django__django-12325 | 431 | 21,854 | 21,652 | 2 | 0 | 378 | 2 | 0 | yes | yes |
| django__django-12708 | 490 | 18,882 | 22,937 | 2 | 0 | 466 | 2 | 0 | yes | yes |
| django__django-13128 | 500 | 31,674 | 31,668 | 2 | 0 | 440 | 2 | 0 | yes | yes |
| django__django-13212 | 470 | 35,981 | 56,252 | 3 | 0 | 404 | 2 | 1 | yes | yes |
| django__django-13344 | 454 | 102,369 | 35,709 | 2 | 0 | 427 | 2 | 0 | yes | yes |
| django__django-13449 | 507 | 32,250 | 46,896 | 2 | 0 | 546 | 2 | 0 | yes | yes |
| django__django-13837 | 438 | 23,371 | 24,378 | 2 | 0 | 419 | 2 | 0 | yes | yes |
| django__django-14007 | 473 | 47,054 | 46,516 | 3 | 0 | 453 | 2 | 1 | yes | yes |
| django__django-14011 | 966 | 43,400 | 49,316 | 2 | 0 | 429 | 2 | 0 | no | no |
| django__django-14631 | 502 | 39,173 | 53,600 | 3 | 0 | 486 | 2 | 1 | yes | yes |
| django__django-15128 | 599 | 50,812 | 53,039 | 3 | 0 | 594 | 2 | 1 | yes | yes |
| django__django-15268 | 496 | 30,942 | 34,528 | 2 | 0 | 444 | 2 | 0 | yes | yes |
| django__django-15503 | 488 | 21,768 | 47,930 | 2 | 0 | 499 | 2 | 0 | yes | yes |
| django__django-15629 | 894 | 103,300 | 269,807 | 7 | 0 | 1,716 | 3 | 4 | yes | yes |
| django__django-15957 | 514 | 42,477 | 40,619 | 3 | 0 | 480 | 2 | 1 | yes | yes |
| django__django-16263 | 452 | 67,106 | 91,338 | 4 | 0 | 405 | 2 | 2 | yes | yes |
| django__django-16560 | 486 | 64,740 | 60,659 | 3 | 0 | 605 | 3 | 0 | yes | yes |
| django__django-16631 | 483 | 42,746 | 42,302 | 3 | 0 | 438 | 2 | 1 | yes | yes |
| pydata__xarray-3993 | 10,829 | 31,215 | 35,384 | 2 | 2 | 1,582 | 2 | 0 | yes | yes |
| pylint-dev__pylint-4551 | 531 | 49,869 | 49,299 | 2 | 3 | 506 | 2 | 0 | yes | yes |
| pylint-dev__pylint-8898 | 299 | 24,307 | 38,081 | 2 | 3 | 379 | 2 | 0 | yes | yes |
| pytest-dev__pytest-10356 | 220 | 71,663 | 50,022 | 2 | 3 | 245 | 2 | 0 | yes | yes |
| pytest-dev__pytest-5787 | 355 | 51,465 | 78,625 | 2 | 4 | 350 | 2 | 0 | yes | yes |
| pytest-dev__pytest-6197 | 285 | 17,677 | 54,715 | 2 | 4 | 388 | 2 | 0 | yes | yes |
| scikit-learn__scikit-learn-25102 | 20,127 | 40,630 | 68,265 | 2 | 4 | 980 | 1 | 1 | yes | yes |
| sphinx-doc__sphinx-11510 | 1,006 | 50,759 | 63,340 | 3 | 3 | 556 | 2 | 1 | yes | yes |
| sphinx-doc__sphinx-8548 | 1,045 | 34,873 | 56,166 | 2 | 2 | 605 | 2 | 0 | yes | yes |
| sphinx-doc__sphinx-9229 | 992 | 86,840 | 52,314 | 3 | 3 | 620 | 2 | 1 | no | no |
| sphinx-doc__sphinx-9461 | 1,098 | 52,176 | 55,600 | 2 | 2 | 693 | 2 | 0 | yes | yes |
| sympy__sympy-12489 | 629 | 42,472 | 40,020 | 3 | 2 | 691 | 2 | 1 | yes | yes |
| sympy__sympy-13852 | 603 | 32,739 | 59,580 | 2 | 4 | 654 | 2 | 0 | yes | yes |
| sympy__sympy-14248 | 5,047 | 179,595 | 220,483 | 4 | 8 | 6,664 | 3 | 1 | no | no |
| sympy__sympy-16597 | 4,443 | 73,079 | 94,085 | 5 | 4 | 6,462 | 3 | 2 | yes | yes |
| sympy__sympy-17630 | 827 | 49,079 | 63,259 | 2 | 2 | 1,025 | 2 | 0 | yes | yes |
| sympy__sympy-18199 | 37,952 | 117,084 | 115,447 | 2 | 2 | 3,954 | 2 | 0 | no | no |

## Other measured context

- Offline top 1 and top 3 recall is 75.4 percent in the committed held-out evaluation.
- The scheduler's default speculative budget is 2.

## Reproduction and invariants

Run `node scripts/analyze-harder-bench.mjs`. It reads the 84 committed traces, recomputes every value above, requires exactly one result per instance and arm, checks row values and wall timing against trace values, requires both seal layers and one resolution event per cell, rejects baseline speculation, and scans model commands for forbidden or outside-workspace paths. The committed analysis passes with no violations.
