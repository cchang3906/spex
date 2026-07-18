#!/usr/bin/env python3
"""Reference normalizer for the Prefetch signature taxonomy (data/taxonomy.yaml).

Pre-event mining-pipeline code (plan §6.2: mining is an offline pre-event step).
The event-day runtime normalizer (src/predictor/signatures.ts) is a fresh TS
implementation of the same contract, unit-tested against data/fixtures_argv.json.

Usage:
  python3 mining/normalize.py --check            # validate fixtures, exit 1 on mismatch
  python3 mining/normalize.py "npm test --silent" # classify one command string
"""
import json
import os
import re
import shlex
import sys

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
VC = json.load(open(os.path.join(DATA, "verb_classes.json")))

PRIORITY = {c: i for i, c in enumerate(VC["class_priority"])}
ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
# A script that IS a test runner by name (Django's tests/runtests.py, test_*.py, tests.py)
TESTISH_SCRIPT = re.compile(r"^(run)?tests?([_.-][^/]*)?\.py$|^test_[^/]*\.py$")


def _basename(tok):
    return tok.rsplit("/", 1)[-1]


def _unwrap_shell(raw):
    """Peel `/bin/zsh -lc '<payload>'` style wrappers; return innermost payload string."""
    while True:
        try:
            toks = shlex.split(raw)
        except ValueError:
            return raw
        if len(toks) >= 3 and _basename(toks[0]) in map(_basename, VC["shell_wrappers"]) and \
                toks[1].startswith("-") and "c" in toks[1]:
            raw = toks[2]
            continue
        return raw


def _segments(payload):
    """Shell-aware split on unquoted && || ; | & — quoted operators stay inside tokens."""
    lex = shlex.shlex(payload, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    try:
        toks = list(lex)
    except ValueError:
        toks = payload.split()
    segs, cur = [], []
    for t in toks:
        if t and all(ch in "|&;" for ch in t):
            if cur:
                segs.append(cur)
            cur = []
        else:
            cur.append(t)
    if cur:
        segs.append(cur)
    return segs


def _lookup_subcommands(table, args):
    sub = next((a for a in args if not a.startswith("-")), None)
    entry = table.get(sub, table.get("*", "OTHER")) if sub else table.get("*", "OTHER")
    if isinstance(entry, dict):
        rest = args[args.index(sub) + 1:] if sub in args else []
        return _lookup_subcommands(entry, rest)
    return entry


def _classify_segment(toks):
    # strip env assignments and benign prefixes
    while toks and (ENV_ASSIGN.match(toks[0]) or _basename(toks[0]) in VC["strip_prefixes"]):
        toks = toks[1:]
    if not toks:
        return "OTHER"
    head_tok, head = toks[0], _basename(toks[0])
    args = toks[1:]

    if head in VC["interpreters"]:
        if "-m" in args:
            mod = args[args.index("-m") + 1] if args.index("-m") + 1 < len(args) else None
            if mod:
                if mod in VC["subcommands"]:
                    return _lookup_subcommands(VC["subcommands"][mod], args[args.index("-m") + 2:])
                return VC["heads"].get(mod, "RUN")
            return "RUN"
        script = next((a for a in args if not a.startswith("-")), None)
        if script and TESTISH_SCRIPT.match(_basename(script)):
            return "TEST"
        return "RUN"  # -c, non-test script file, or bare interpreter

    if head in VC["runner_wrappers"]:
        inner = next((a for a in args if not a.startswith("-")), None)
        if inner:
            return _classify_segment([inner] + args[args.index(inner) + 1:])
        return "RUN"

    # yarn dlx / pnpm dlx behave like npx
    if head in ("yarn", "pnpm") and args and args[0] == "dlx":
        return _classify_segment(args[1:]) if len(args) > 1 else "RUN"

    if head in VC["subcommands"]:
        return _lookup_subcommands(VC["subcommands"][head], args)
    if head in VC["heads"]:
        return VC["heads"][head]
    if head_tok.startswith("./") or head.endswith(".sh") or head.endswith(".py"):
        return "TEST" if TESTISH_SCRIPT.match(head) else "RUN"
    return "OTHER"


def classify(raw):
    payload = _unwrap_shell(raw)
    classes = [_classify_segment(seg) for seg in _segments(payload)] or ["OTHER"]
    return min(classes, key=lambda c: PRIORITY.get(c, len(PRIORITY)))


def check():
    fixtures = json.load(open(os.path.join(DATA, "fixtures_argv.json")))["fixtures"]
    failures = []
    for f in fixtures:
        got = classify(f["raw"])
        if got != f["expect"]:
            failures.append((f["raw"], f["expect"], got))
    for raw, want, got in failures:
        print(f"MISMATCH: want {want:9s} got {got:9s} : {raw}")
    print(f"{len(fixtures) - len(failures)}/{len(fixtures)} fixtures pass")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        sys.exit(check())
    print(classify(" ".join(sys.argv[1:])))
