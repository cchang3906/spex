#!/usr/bin/env python3
"""Ingest SWE-bench leaderboard trajectories into normalized event streams (taxonomy v1).

Usage: python3 mining/ingest.py [raw_root]
Writes data/normalized_train.jsonl + data/normalized_validation.jsonl.
Split is by INSTANCE id hash (85/15) so one instance never straddles both sets
across scaffolds.
"""
import glob
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from normalize import classify, _basename  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
RAW = sys.argv[1] if len(sys.argv) > 1 else "mining/raw"

EXT_MAP = {
    "py": ("py", "pyi"),
    "ts_js": ("ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"),
    "rs": ("rs",), "go": ("go",),
    "config": ("json", "yaml", "yml", "toml", "ini", "cfg", "lock", "txt"),
}
FAIL_RE = re.compile(r"(?i)(traceback|assertionerror|\b\d+ (failed|errors?)\b|\bFAILED\b|error:)")
STATUSED = {"TEST", "LINT", "TYPECHECK", "BUILD", "RUN"}  # classes whose pass/fail we infer


def ext_class(path):
    e = (path or "").rsplit(".", 1)[-1].lower() if "." in (path or "") else ""
    for cls, exts in EXT_MAP.items():
        if e in exts:
            return cls
    return "other"


def edit_ev(path):
    return {"sig": f"EDIT({ext_class(path)})"}


def cmd_ev(raw, cls, failed):
    status = "failed" if (failed and cls in STATUSED) else "passed"
    return {"sig": f"{cls}({status})", "cls": cls, "raw": (raw or "")[:200]}


def flatten(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict))
    return str(content)


def sre_event(action_tokens, joined):
    """Map a str_replace_editor invocation (tokenized) to an event."""
    sub = action_tokens[0] if action_tokens else ""
    path = next((t for t in action_tokens[1:] if not t.startswith("-")), "")
    if sub == "view":
        return {"sig": "READ(passed)", "cls": "READ", "raw": joined[:200]}
    if sub in ("create", "str_replace", "insert", "undo_edit"):
        return edit_ev(path)
    return None


# ---------------------------------------------------------------- SWE-agent (.traj, old ACI + new tools)
ACI_READ = {"open", "goto", "scroll_up", "scroll_down"}
ACI_GREP = {"search_file", "search_dir", "find_file"}


def parse_sweagent(path):
    d = json.load(open(path))
    events = []
    for step in d.get("trajectory", []):
        action = (step.get("action") or "").strip()
        if not action:
            continue
        head = action.split()[0]
        obs = str(step.get("observation") or "")
        if head == "submit" or head == "exit_cost":
            continue
        if head in ACI_READ:
            events.append({"sig": "READ(passed)", "cls": "READ", "raw": action[:200]})
        elif head in ACI_GREP:
            events.append({"sig": "GREP(passed)", "cls": "GREP", "raw": action[:200]})
        elif head == "create":
            events.append(edit_ev(action.split()[1] if len(action.split()) > 1 else ""))
        elif head == "edit":
            open_file = ""
            try:
                open_file = json.loads(step.get("state") or "{}").get("open_file", "")
            except (json.JSONDecodeError, TypeError):
                pass
            events.append(edit_ev(open_file))
        elif head == "str_replace_editor":
            ev = sre_event(action.split()[1:], action)
            if ev:
                events.append(ev)
        else:
            cls = classify(action)
            events.append(cmd_ev(action, cls, bool(FAIL_RE.search(obs[:4000]))))
    return events


# ---------------------------------------------------------------- OpenHands (chat messages + tool_calls)
EXITCODE_RE = re.compile(r"\[Command finished with exit code (\d+)")


def parse_openhands(path):
    msgs = json.load(open(path))
    calls = {}  # tool_call_id -> (name, args)
    events = []
    for m in msgs:
        if m.get("tool_calls"):
            for tc in m["tool_calls"]:
                f = tc.get("function", {})
                try:
                    args = json.loads(f.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                calls[tc.get("id")] = (f.get("name"), args)
        elif m.get("role") == "tool":
            name, args = calls.get(m.get("tool_call_id"), (m.get("name"), {}))
            content = flatten(m.get("content"))
            if name == "execute_bash":
                cmd = args.get("command", "")
                if not cmd:
                    continue
                mm = EXITCODE_RE.search(content)
                failed = (mm and mm.group(1) != "0") or (not mm and bool(FAIL_RE.search(content[:4000])))
                events.append(cmd_ev(cmd, classify(cmd), failed))
            elif name == "str_replace_editor":
                sub, p = args.get("command", ""), args.get("path", "")
                if sub == "view":
                    events.append({"sig": "READ(passed)", "cls": "READ", "raw": f"str_replace_editor view {p}"[:200]})
                elif sub in ("create", "str_replace", "insert", "undo_edit"):
                    events.append(edit_ev(p))
    return events


# ---------------------------------------------------------------- mini-swe-agent (bash blocks + returncode tags)
BASH_BLOCK_RE = re.compile(r"```bash\n(.*?)```", re.S)
RC_RE = re.compile(r"<returncode>(\d+)</returncode>")
WRITE_RE = re.compile(r"(?:cat\s*>>?\s*|tee\s+(?:-a\s+)?|sed\s+-i[^ ]*\s+(?:'[^']*'\s+)?)(\S+)")
# mini-swe-agent scaffold artifacts: self-authored edit helper scripts and file-writing heredocs
EDIT_HELPER_RE = re.compile(r"python3?\s+(?:\S*/)?edit\w*\.py\s+(?:(?:replace|insert|append)\s+)?(\S+)")
HEREDOC_TARGET_RE = re.compile(r"open\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"][wa]|['\"]([^'\"]+)['\"]\s*\)\.write_text\(")


def minisweagent_edit_target(cmd):
    m = EDIT_HELPER_RE.search(cmd)
    if m:
        return m.group(1)
    if "<<" in cmd:
        m = HEREDOC_TARGET_RE.search(cmd)
        if m:
            return m.group(1) or m.group(2)
    return None


def parse_minisweagent(path):
    d = json.load(open(path))
    events = []
    pending = None
    for m in d.get("messages", []):
        if m.get("role") == "assistant":
            b = BASH_BLOCK_RE.search(flatten(m.get("content")))
            pending = b.group(1).strip() if b else None
        elif m.get("role") == "user" and pending is not None:
            rc = RC_RE.search(flatten(m.get("content")))
            if rc:
                w = WRITE_RE.search(pending)
                target = w.group(1) if w else minisweagent_edit_target(pending)
                if target:
                    events.append(edit_ev(target))
                else:
                    events.append(cmd_ev(pending, classify(pending), rc.group(1) != "0"))
                pending = None
    return events


SUBMISSIONS = [
    ("20240402_sweagent_gpt4", "sweagent", "gpt-4", "trajs/*.traj", parse_sweagent),
    ("20250522_sweagent_claude-4-sonnet-20250514", "sweagent", "claude-4-sonnet", "trajs/*/*.traj", parse_sweagent),
    ("20250524_openhands_claude_4_sonnet", "openhands", "claude-4-sonnet", "trajs/*.json", parse_openhands),
    ("20250807_openhands_gpt5", "openhands", "gpt-5", "trajs/*.json", parse_openhands),
    ("20251215_livesweagent_claude-opus-4-5", "mini-swe-agent", "claude-opus-4-5", "trajs/*/*.traj.json", parse_minisweagent),
    # 20251127_openhands_claude-opus-4-5 EXCLUDED: export redacts commands ("Action: unknown")
]


def instance_id(path):
    base = _basename(path)
    for suf in (".traj.json", ".traj", ".json"):
        if base.endswith(suf):
            return base[: -len(suf)]
    return base


def main():
    train = open(os.path.join(DATA, "normalized_train.jsonl"), "w")
    val = open(os.path.join(DATA, "normalized_validation.jsonl"), "w")
    stats = {}
    for sub, scaffold, model, pattern, parser in SUBMISSIONS:
        files = sorted(glob.glob(os.path.join(RAW, sub, pattern)))
        n_ok = n_err = n_events = 0
        for f in files:
            inst = instance_id(f)
            try:
                events = parser(f)
            except Exception:
                n_err += 1
                continue
            if not events:
                n_err += 1
                continue
            rec = {"traj_id": f"{sub}/{inst}", "scaffold": scaffold, "model": model,
                   "instance": inst, "events": events}
            bucket = int(hashlib.md5(inst.encode()).hexdigest(), 16) % 100
            (train if bucket < 85 else val).write(json.dumps(rec) + "\n")
            n_ok += 1
            n_events += len(events)
        stats[sub] = (len(files), n_ok, n_err, n_events)
        print(f"{sub}: {n_ok}/{len(files)} parsed ({n_err} skipped), {n_events} events")
    train.close(); val.close()


if __name__ == "__main__":
    main()
