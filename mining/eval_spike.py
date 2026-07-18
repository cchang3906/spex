#!/usr/bin/env python3
"""Out-of-distribution check: score the mined pattern table against REAL Codex
event streams captured in the pre-event spike (documentation/spike/samples/).

The mining corpus is SWE-bench agents (sweagent/openhands/mini-swe-agent); the
runtime target is Codex. This asks: at each Codex verification event, would the
prior have predicted it from the preceding context?
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from normalize import classify  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SAMPLES = os.path.join(ROOT, "documentation", "spike", "samples")
ALLOW = {"TEST", "LINT", "TYPECHECK", "BUILD"}
K = 3
EXIT_RE = re.compile(r"exit code: (\d+)")


def ext_class(path):
    e = (path or "").rsplit(".", 1)[-1].lower()
    return {"py": "py", "pyi": "py"}.get(e, "config" if e in ("json", "yaml", "toml", "txt", "md") else "other")


def streams_from_log(path):
    """Rebuild per-thread signature streams from a spike JSONL protocol log."""
    call_exit = {}   # callId -> exit code we served (from our DynamicToolCallResponse)
    req_call = {}    # rpc id -> callId (item/tool/call server requests)
    threads = {}
    for line in open(path):
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        m = e.get("msg", {})
        if not isinstance(m, dict):
            continue
        if e["dir"] == "in" and m.get("method") == "item/tool/call":
            req_call[m.get("id")] = m.get("params", {}).get("callId")
        if e["dir"] == "out" and m.get("id") in req_call and isinstance(m.get("result"), dict):
            text = " ".join(c.get("text", "") for c in m["result"].get("contentItems", []))
            mm = EXIT_RE.search(text)
            if mm:
                call_exit[req_call[m["id"]]] = int(mm.group(1))
        if e["dir"] == "in" and m.get("method") == "item/completed":
            p = m.get("params", {})
            item = p.get("item", {})
            sigs = threads.setdefault(p.get("threadId"), [])
            t = item.get("type")
            if t == "fileChange":
                path0 = ""
                ch = item.get("changes") or []
                if ch and isinstance(ch[0], dict):
                    path0 = ch[0].get("path") or ch[0].get("filePath") or ""
                sigs.append(f"EDIT({ext_class(path0)})")
            elif t == "commandExecution":
                cls = classify(item.get("command") or "")
                if item.get("status") == "declined":
                    status = "declined"
                else:
                    status = "passed" if item.get("exitCode") == 0 else "failed"
                sigs.append(f"{cls}({status})")
            elif t == "dynamicToolCall" and item.get("tool") == "prefetch_verify":
                kind = (item.get("arguments") or {}).get("kind", "test").upper()
                code = call_exit.get(item.get("id"))
                sigs.append(f"{kind}({'passed' if code == 0 else 'failed' if code is not None else 'passed'})")
    return {tid: s for tid, s in threads.items() if len(s) >= 3}


def predict(table, window):
    cands = {}
    for k in range(1, min(K, len(window)) + 1):
        for cls, p in table.get(tuple(window[-k:]), []):
            cands[cls] = max(cands.get(cls, 0.0), p)
    return sorted(cands.items(), key=lambda x: -x[1])


def main():
    t = json.load(open(os.path.join(ROOT, "data", "pattern_table.json")))
    table = {}
    for p in t["patterns"]:
        table.setdefault(tuple(p["context"]), []).append((p["predicts"], p["p"]))

    total = hit2 = 0
    for f in ("phaseB.jsonl", "phaseG.jsonl"):
        for tid, sigs in streams_from_log(os.path.join(SAMPLES, f)).items():
            print(f"{f} thread {tid[:8]}…: {sigs}")
            for i in range(1, len(sigs)):
                if sigs[i].split("(")[0] in ALLOW:
                    total += 1
                    preds = [c for c, _ in predict(table, sigs[max(0, i - K):i])[:2]]
                    ok = sigs[i].split("(")[0] in preds
                    hit2 += ok
                    print(f"   ctx={sigs[max(0, i - K):i]} -> true={sigs[i]} pred={preds} {'HIT' if ok else 'MISS'}")
    print(f"\nCodex spike streams: top-2 recall {hit2}/{total} = {hit2/max(total,1):.0%}")


if __name__ == "__main__":
    main()
