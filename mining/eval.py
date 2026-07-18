#!/usr/bin/env python3
"""Offline miner eval on the held-out validation split. Go/no-go gates:
top-3 recall >= 40%, executable rate >= 70% (see mining/README.md definitions).

Also reports the runtime-shaped auxiliary: speculations fired at EDIT triggers
that would have been served before the next epoch bump (next EDIT).
"""
import json
import os
from collections import Counter

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
ALLOW = {"TEST", "LINT", "TYPECHECK", "BUILD"}
K = 3
RUNTIME_TOPK = 2  # plan §6.2: top-K speculation slots


def load_table():
    t = json.load(open(os.path.join(DATA, "pattern_table.json")))
    m = {}
    for p in t["patterns"]:
        m.setdefault(tuple(p["context"]), []).append((p["predicts"], p["p"]))
    return m


def predict(table, window):
    cands = {}
    for k in range(1, min(K, len(window)) + 1):
        for cls, p in table.get(tuple(window[-k:]), []):
            cands[cls] = max(cands.get(cls, 0.0), p)
    return sorted(cands.items(), key=lambda x: -x[1])


def main():
    table = load_table()
    recall = Counter()      # topN hits
    total = 0
    fired = exec_learned = exec_with_heur = 0
    trig_fired = trig_useful = 0
    per_scaffold = {}

    for line in open(os.path.join(DATA, "normalized_validation.jsonl")):
        r = json.loads(line)
        sigs = [e["sig"] for e in r["events"]]
        classes = [s.split("(")[0] for s in sigs]
        seen_argv = set()  # classes with an observed authoritative argv so far (learned tier)
        ps = per_scaffold.setdefault(r["scaffold"], Counter())

        for i in range(1, len(sigs)):
            window = sigs[max(0, i - K):i]
            # --- gate metric 1: top-N recall over events whose TRUE next class is allow-listed
            if classes[i] in ALLOW:
                total += 1
                ps["total"] += 1
                preds = [c for c, _ in predict(table, window)]
                for n in (1, 2, 3):
                    if classes[i] in preds[:n]:
                        recall[n] += 1
                        if n == 3:
                            ps["top3"] += 1
                # --- gate metric 2: executable rate of fired candidates (runtime K)
                for c in preds[:RUNTIME_TOPK]:
                    fired += 1
                    learned = c in seen_argv
                    exec_learned += learned
                    exec_with_heur += learned or c == "TEST"  # pytest ecosystem-derivable
            # --- auxiliary: trigger-shaped usefulness (speculate at EDIT, serve before next EDIT)
            if sigs[i - 1].startswith("EDIT("):
                cands = predict(table, window)[:RUNTIME_TOPK]
                for c, _ in cands:
                    trig_fired += 1
                    horizon = []
                    for j in range(i, len(classes)):
                        if sigs[j].startswith("EDIT("):
                            break
                        horizon.append(classes[j])
                    trig_useful += c in horizon
            if r["events"][i].get("cls") in ALLOW and r["events"][i].get("raw"):
                seen_argv.add(classes[i])

    print(f"validation events with allow-listed next class: {total}")
    for n in (1, 2, 3):
        print(f"  top-{n} recall: {recall[n]/total:6.1%}  (gate top-3 >= 40%)")
    print(f"fired candidates (top-{RUNTIME_TOPK}): {fired}")
    print(f"  executable (learned tier only):      {exec_learned/fired:6.1%}")
    print(f"  executable (learned + TEST heuristic): {exec_with_heur/fired:6.1%}  (gate >= 70%)")
    print(f"EDIT-trigger speculations fired: {trig_fired}; served-before-next-edit: {trig_useful/max(trig_fired,1):6.1%}")
    print("\nper-scaffold top-3 recall:")
    for s, c in per_scaffold.items():
        print(f"  {s:15s} {c['top3']/max(c['total'],1):6.1%}  (n={c['total']})")
    gates = {"top3_recall": recall[3] / total if total else 0.0,
             "executable_rate": exec_with_heur / fired if fired else 0.0}
    verdict = "GO" if gates["top3_recall"] >= 0.40 and gates["executable_rate"] >= 0.70 else "NO-GO"
    print(f"\nVERDICT: {verdict}  {gates}")


if __name__ == "__main__":
    main()
