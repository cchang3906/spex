#!/bin/bash
set -euo pipefail
inst="${1:?usage: swebench-repo.sh <instance_id> <outdir> [--baseline]}"
out="${2:?outdir}"
mode="${3:-steered}"
meta="$(cd "$(dirname "$0")/../.." && pwd)/data/swebench-instances.json"

repo=$(python3 -c "import json;print(json.load(open('$meta'))['$inst']['repo'])")
base=$(python3 -c "import json;print(json.load(open('$meta'))['$inst']['base_commit'])")
cache_root="${SWB_CACHE:-$HOME/.cache/spex-swb}"
cache=$cache_root/$(basename "$repo")
mkdir -p "$cache_root"
if [ ! -d "$cache/.git" ]; then git clone -q "https://github.com/$repo" "$cache"; fi
git -C "$cache" fetch -q origin "$base" 2>/dev/null || true

rm -rf "$out" && mkdir -p "$out"
git -C "$cache" archive "$base" | tar -x -C "$out"
python3 -c "import json;open('/tmp/tp.diff','w').write(json.load(open('$meta'))['$inst']['test_patch'])"
git -C "$out" init -q 2>/dev/null || true
cd "$out"
git apply /tmp/tp.diff
rm -rf .git
printf '__pycache__/\n.prefetch/\n.venv/\n*.egg-info/\n' > .gitignore

if [ "$mode" != "--baseline" ]; then
cat > AGENTS.md <<'EOF'
## Verification
This workspace provides a `prefetch_verify` tool. Whenever you need to run tests, lint,
typechecking, or a build to verify your changes, ALWAYS call `prefetch_verify` with the
appropriate kind instead of running those commands in the terminal. Call `prefetch_verify`
with kind "test" to reproduce the failure and again after every change you make. The project virtualenv is at .venv; when you do use the terminal for anything python related, use ./.venv/bin/python. It executes the exact same
command in the same sandbox and returns the exit code and output — usually much faster, because
the result may already be prepared. For all other commands, use the terminal normally.
EOF
fi

PYBIN=$(command -v python3.11 || command -v python3.12 || command -v python3)
$PYBIN -m venv .venv
WHEELS="${SPEX_WHEELS:-$HOME/.cache/spex-wheels}"
pins=""
case "$repo" in
  pallets/flask) pins='werkzeug<3 jinja2<3.2 click<8.2' ;;
esac
ver=$(python3 -c "import json;print(json.load(open('$meta'))['$inst'].get('version','0'))")
if [ -d "$WHEELS" ]; then ./.venv/bin/pip -q install --no-index --find-links "$WHEELS" setuptools wheel 2>/dev/null || true; fi
SETUPTOOLS_SCM_PRETEND_VERSION="${ver}.0" ./.venv/bin/pip -q install --no-build-isolation -e . $pins 2>&1 | tail -1 || SETUPTOOLS_SCM_PRETEND_VERSION="${ver}.0" ./.venv/bin/pip -q install -e . $pins 2>&1 | tail -1
if ! ./.venv/bin/python -c "import pytest" 2>/dev/null; then ./.venv/bin/pip -q install "pytest<8" 2>/dev/null || ./.venv/bin/pip -q install --no-index --find-links "$WHEELS" "pytest<8"; fi
git init -q && git add -A && git -c user.name="Dev" -c user.email="dev@example.com" -c commit.gpgsign=false commit -qm "initial commit"

f2p=$(python3 - "$meta" "$inst" <<'PYF2P'
import json, re, sys
row = json.load(open(sys.argv[1]))[sys.argv[2]]
names = json.loads(row["FAIL_TO_PASS"])
if any("::" in n for n in names):
    print(" ".join(names))
else:
    files = sorted(set(re.findall(r"\+\+\+ b/(\S+)", row["test_patch"])))
    ks = " or ".join(sorted({n.split("[")[0] for n in names}))
    print(" ".join(files) + " -k '" + ks + "'")
PYF2P
)
mkdir -p .prefetch
printf '%s' "$f2p" > .prefetch/f2p
verify=$(python3 -c "import json;print(json.load(open('$meta'))['$inst'].get('verify',''))")
if [ -n "$verify" ] && [ "$mode" != "--baseline" ]; then
python3 - "$verify" "$PWD" <<'PYSEED'
import json, sys
argv = sys.argv[1].split()
json.dump({"repoDir": sys.argv[2], "learned": {"TEST": {"argv": argv, "cwd": sys.argv[2]}}},
          open(".prefetch/verifiers.json", "w"), indent=2)
PYSEED
fi
set +e
eval ./.venv/bin/python -m pytest -q --no-header $f2p > /tmp/f2p-check.log 2>&1
rc=$?
set -e
echo "$inst -> $out ($mode) · fail_to_pass exit=$rc (must be nonzero) · $(tail -1 /tmp/f2p-check.log)"
