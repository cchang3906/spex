#!/bin/bash
set -euo pipefail
inst="${1:?usage: swebench-repo.sh <instance_id> <outdir> [--baseline]}"
out="${2:?outdir}"
mode="${3:-steered}"
meta="$(cd "$(dirname "$0")/.." && pwd)/data/swebench-instances.json"

repo=$(python3 -c "import json; row=json.load(open('$meta'))['$inst']; print(row.get('repo') or '$inst'.rsplit('-', 1)[0].replace('__', '/'))")
base=$(python3 -c "import json;print(json.load(open('$meta'))['$inst']['base_commit'])")
verify=$(python3 -c "import json;print(json.load(open('$meta'))['$inst'].get('verify',''))")
cache_root="${SWB_CACHE:-$HOME/.cache/spex-swb}"
owner=${repo%/*}
name=${repo#*/}
mirror=$cache_root/$owner/$name.git
legacy=$cache_root/$name
mkdir -p "$cache_root"
if [ -d "$mirror" ]; then
  cache=$mirror
  git_repo=(git --git-dir="$cache")
elif [ -d "$legacy/.git" ]; then
  cache=$legacy
  git_repo=(git -C "$cache")
else
  mkdir -p "$(dirname "$mirror")"
  git clone -q --mirror "https://github.com/$repo.git" "$mirror"
  cache=$mirror
  git_repo=(git --git-dir="$cache")
fi
"${git_repo[@]}" fetch -q origin "$base" 2>/dev/null || true

rm -rf "$out" && mkdir -p "$out"
"${git_repo[@]}" archive "$base" | tar -x -C "$out"
git -C "$out" init -q 2>/dev/null || true
python3 - "$meta" "$inst" <<'PYPATCH' | git -C "$out" apply -
import json, sys
sys.stdout.write(json.load(open(sys.argv[1]))[sys.argv[2]]["test_patch"])
PYPATCH
cd "$out"
rm -rf .git
printf '__pycache__/\n.prefetch/\n.venv/\n*.egg-info/\n' > .gitignore

if [ "$mode" != "--baseline" ]; then
VERIFY="$verify" python3 - <<'PYAGENTS'
import os
verify = os.environ["VERIFY"]
open("AGENTS.md", "w").write(f"""## Verification
This workspace provides a `prefetch_verify` tool. Reproduce the failure by running EXACTLY
`{verify}` through `prefetch_verify` with kind "test". Verify every fix with the SAME command
through `prefetch_verify`. Do not substitute a narrower or different test command. The project
virtualenv is at .venv; use ./.venv/bin/python for all other Python commands.
""")
PYAGENTS
fi

PYBIN=$(command -v python3.11)
"$PYBIN" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)'
$PYBIN -m venv .venv
WHEELS="${SPEX_WHEELS:-$HOME/.cache/spex-wheels}"
packages=("pytest<8")
compat=""
extras=""
project_install="editable"
project_version=""
case "$inst" in
  pydata__xarray-6992|pydata__xarray-3993)
    packages=("numpy==1.23.5" "packaging==23.1" "pandas==1.5.3" "pytest==7.4.0" "python-dateutil==2.8.2" "pytz==2023.3" "six==1.16.0" "scipy==1.11.1" "setuptools==68.0.0" "dask==2022.8.1") ;;
  sphinx-doc__sphinx-7590|sphinx-doc__sphinx-8548)
    packages=("pytest==7.4.0" "Jinja2==2.11.3" "MarkupSafe==2.0.1" "docutils==0.16" "alabaster==0.7.11" "sphinxcontrib-applehelp==1.0.4" "sphinxcontrib-devhelp==1.0.2" "sphinxcontrib-htmlhelp==2.0.1" "sphinxcontrib-qthelp==1.0.3" "sphinxcontrib-serializinghtml==1.1.5" "pytest-cov==4.1.0" "html5lib==1.1" "Cython==0.29.36") ;;
  sphinx-doc__sphinx-9229|sphinx-doc__sphinx-9461)
    packages=("pytest==7.4.0" "Jinja2==2.11.3" "MarkupSafe==2.0.1" "docutils==0.16" "alabaster==0.7.11" "sphinxcontrib-applehelp==1.0.4" "sphinxcontrib-devhelp==1.0.2" "sphinxcontrib-htmlhelp==2.0.1" "sphinxcontrib-qthelp==1.0.3" "sphinxcontrib-serializinghtml==1.1.5" "pytest-cov==4.1.0" "html5lib==1.1" "Cython==0.29.36")
    compat="types-union" ;;
  sphinx-doc__sphinx-11510)
    packages=("pytest==7.4.0" "Jinja2==3.0.3" "tox==4.16.0" "tox-current-env==0.0.11")
    extras="test" ;;
  sympy__sympy-12489|sympy__sympy-13878|sympy__sympy-13852|sympy__sympy-14248)
    packages=("pytest==7.4.0" "mpmath==1.3.0" "setuptools==68.0.0")
    compat="collections-abc" ;;
  sympy__sympy-16597|sympy__sympy-17630|sympy__sympy-18199)
    packages=("pytest==7.4.0" "mpmath==1.3.0" "setuptools==68.0.0") ;;
  pylint-dev__pylint-4551)
    compat="pylint-2.9" ;;
  pytest-dev__pytest-5787)
    compat="pytest-5"
    project_version="5.1" ;;
  pytest-dev__pytest-6197)
    compat="pytest-5"
    project_version="5.2" ;;
  pytest-dev__pytest-10356)
    project_version="7.2" ;;
  scikit-learn__scikit-learn-25102)
    packages=("Cython==3.0.10" "joblib==1.3.2" "matplotlib==3.8.4" "numpy==1.23.5" "pandas==1.5.3" "pytest==7.4.0" "scipy==1.10.1" "setuptools==68.0.0" "threadpoolctl==3.2.0")
    project_install="setup-develop" ;;
esac

site=".venv/lib/python3.11/site-packages"
if [ -n "$compat" ]; then
  case "$compat" in
    collections-abc)
      cat > "$site/spex_compat.py" <<'PYCOMPAT'
import collections
import collections.abc
for _name in ("Callable", "Collection", "Container", "Hashable", "ItemsView", "Iterable", "Iterator", "KeysView", "Mapping", "MappingView", "MutableMapping", "MutableSequence", "MutableSet", "Reversible", "Sequence", "Set", "Sized", "ValuesView"):
    if not hasattr(collections, _name):
        setattr(collections, _name, getattr(collections.abc, _name))
PYCOMPAT
      ;;
    types-union)
      cat > "$site/spex_compat.py" <<'PYCOMPAT'
import types
if not hasattr(types, "Union"):
    types.Union = types.UnionType
PYCOMPAT
      ;;
    pytest-5)
      cat > "$site/spex_compat.py" <<'PYCOMPAT'
import ast
import builtins
_spex_compile = builtins.compile
def _compile(source, filename, mode, flags=0, dont_inherit=False, optimize=-1, **kwargs):
    if isinstance(source, ast.AST):
        source = ast.fix_missing_locations(source)
    return _spex_compile(source, filename, mode, flags, dont_inherit, optimize, **kwargs)
builtins.compile = _compile
PYCOMPAT
      ;;
    pylint-2.9)
      cat > "$site/spex_compat.py" <<'PYCOMPAT'
import collections
import collections.abc
import inspect
for _name in ("Callable", "Collection", "Container", "Hashable", "ItemsView", "Iterable", "Iterator", "KeysView", "Mapping", "MappingView", "MutableMapping", "MutableSequence", "MutableSet", "Reversible", "Sequence", "Set", "Sized", "ValuesView"):
    if not hasattr(collections, _name):
        setattr(collections, _name, getattr(collections.abc, _name))
def _formatargspec(args, varargs=None, varkw=None, defaults=None, kwonlyargs=(), kwonlydefaults=None, annotations=None, formatarg=str, formatvarargs=lambda name: "*" + name, formatvarkw=lambda name: "**" + name, formatvalue=lambda value: "=" + repr(value), formatreturns=lambda text: " -> " + text, formatannotation=inspect.formatannotation):
    kwonlydefaults = kwonlydefaults or {}
    annotations = annotations or {}
    specs = []
    firstdefault = len(args) - len(defaults) if defaults else len(args)
    for index, arg in enumerate(args):
        spec = formatarg(arg)
        if arg in annotations:
            spec += ": " + formatannotation(annotations[arg])
        if defaults and index >= firstdefault:
            spec += formatvalue(defaults[index - firstdefault])
        specs.append(spec)
    if varargs:
        spec = formatvarargs(varargs)
        if varargs in annotations:
            spec += ": " + formatannotation(annotations[varargs])
        specs.append(spec)
    elif kwonlyargs:
        specs.append("*")
    for kwarg in kwonlyargs:
        spec = formatarg(kwarg)
        if kwarg in annotations:
            spec += ": " + formatannotation(annotations[kwarg])
        if kwarg in kwonlydefaults:
            spec += formatvalue(kwonlydefaults[kwarg])
        specs.append(spec)
    if varkw:
        spec = formatvarkw(varkw)
        if varkw in annotations:
            spec += ": " + formatannotation(annotations[varkw])
        specs.append(spec)
    result = "(" + ", ".join(specs) + ")"
    if "return" in annotations:
        result += formatreturns(formatannotation(annotations["return"]))
    return result
if not hasattr(inspect, "formatargspec"):
    inspect.formatargspec = _formatargspec
PYCOMPAT
      ;;
  esac
  printf 'import spex_compat\n' > "$site/spex_compat.pth"
fi

constraints=".venv/spex-constraints.txt"
printf '%s\n' "${packages[@]}" > "$constraints"
pip_args=(--disable-pip-version-check --no-input)
if ! ./.venv/bin/python -m pip install "${pip_args[@]}" "${packages[@]}"; then
  ./.venv/bin/python -m pip install "${pip_args[@]}" --no-index --find-links "$WHEELS" "${packages[@]}"
fi
if [ "$project_install" = "setup-develop" ]; then
  PIP_CONSTRAINT="$PWD/$constraints" ./.venv/bin/python setup.py develop
else
  target="."
  if [ -n "$extras" ]; then target=".[$extras]"; fi
  if [ -n "$project_version" ]; then
    PIP_CONSTRAINT="$PWD/$constraints" SETUPTOOLS_SCM_PRETEND_VERSION="$project_version" ./.venv/bin/python -m pip install "${pip_args[@]}" -e "$target"
  else
    PIP_CONSTRAINT="$PWD/$constraints" ./.venv/bin/python -m pip install "${pip_args[@]}" -e "$target"
  fi
fi
git init -q && git add -A && git -c user.name="Dev" -c user.email="dev@example.com" -c commit.gpgsign=false commit -qm "initial commit"

f2p=$(python3 - "$meta" "$inst" <<'PYF2P'
import json, re, sys
row = json.load(open(sys.argv[1]))[sys.argv[2]]
names = json.loads(row.get("FAIL_TO_PASS", "[]"))
files = sorted(set(re.findall(r"\+\+\+ b/(\S+)", row["test_patch"])))
if any("::" in n for n in names):
    print(" ".join(names))
elif names:
    ks = " or ".join(sorted({n.split("[")[0] for n in names}))
    print(" ".join(files) + " -k '" + ks + "'")
else:
    print(" ".join(files))
PYF2P
)
mkdir -p .prefetch
printf '%s' "$f2p" > .prefetch/f2p
if [ -n "$verify" ] && [ "$mode" != "--baseline" ]; then
python3 - "$verify" "$PWD" <<'PYSEED'
import json, shlex, sys
argv = shlex.split(sys.argv[1])
json.dump({"repoDir": sys.argv[2], "learned": {"TEST": {"argv": argv, "cwd": sys.argv[2]}}},
          open(".prefetch/verifiers.json", "w"), indent=2)
PYSEED
fi
echo "$inst -> $out ($mode) · prepared for sealed verification"
