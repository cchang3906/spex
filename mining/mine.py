#!/usr/bin/env python3
"""Suffix-count miner (plan §6.2, PASTE Algorithm-1 style) -> data/pattern_table.json.

For every event position, every suffix (length 1..k) of the preceding signature
window is a context. p(class | context) = co-occurrences / context occurrences.
Keep allow-listed target classes with support >= MIN_SUPPORT and p >= TAU.
"""
import json
import os
import sys
from collections import Counter, defaultdict

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
K = 3
MIN_SUPPORT = 20
TAU = 0.35
ALLOW = {"TEST", "LINT", "TYPECHECK", "BUILD"}


def main():
    exclude = set()
    out_name = "pattern_table.json"
    if "--exclude" in sys.argv:
        i = sys.argv.index("--exclude")
        exclude = set(sys.argv[i + 1].split(","))
        out_name = "pattern_table_bench.json"
    denom = Counter()
    num = defaultdict(Counter)
    n_traj = n_events = n_excluded = 0
    for line in open(os.path.join(DATA, "normalized_train.jsonl")):
        r = json.loads(line)
        if r.get("instance") in exclude:
            n_excluded += 1
            continue
        sigs = [e["sig"] for e in r["events"]]
        classes = [e["sig"].split("(")[0] for e in r["events"]]
        n_traj += 1
        n_events += len(sigs)
        for i in range(1, len(sigs)):
            for k in range(1, min(K, i) + 1):
                ctx = tuple(sigs[i - k:i])
                denom[ctx] += 1
                if classes[i] in ALLOW:
                    num[ctx][classes[i]] += 1

    patterns = []
    for ctx, targets in num.items():
        for cls, support in targets.items():
            p = support / denom[ctx]
            if support >= MIN_SUPPORT and p >= TAU:
                patterns.append({"context": list(ctx), "predicts": cls,
                                 "p": round(p, 4), "support": support})
    patterns.sort(key=lambda x: -x["support"])
    table = {"k": K, "minSupport": MIN_SUPPORT, "tau": TAU,
             "minedFrom": {"trajectories": n_traj, "events": n_events,
                           "source": "swe-bench/experiments verified: 2x sweagent (gpt-4, claude-4-sonnet), 2x openhands (claude-4-sonnet, gpt-5), 1x mini-swe-agent (claude-opus-4-5)"},
             "patterns": patterns}
    if exclude:
        table["excludedInstances"] = sorted(exclude)
        table["excludedTrajectories"] = n_excluded
    out = os.path.join(DATA, out_name)
    json.dump(table, open(out, "w"), indent=1)
    print(f"{len(patterns)} patterns from {n_traj} trajs / {n_events} events -> {out}")
    for pat in patterns[:12]:
        print(f"  {'|'.join(pat['context']):55s} -> {pat['predicts']:9s} p={pat['p']:.2f} n={pat['support']}")


if __name__ == "__main__":
    main()
