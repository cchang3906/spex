import fs from 'node:fs';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync(new URL('../../data/verb_classes.json', import.meta.url)));
const LEARNABLE = ['TEST', 'LINT', 'TYPECHECK', 'BUILD'];

function tokenize(str) {
  const segs = [[]];
  let tok = '';
  let has = false;
  let q = null;
  const flush = () => {
    if (has || tok) segs[segs.length - 1].push(tok);
    tok = '';
    has = false;
  };
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (q === "'") {
      if (c === "'") q = null;
      else tok += c;
    } else if (q === '"') {
      if (c === '\\' && i + 1 < str.length) tok += str[++i];
      else if (c === '"') q = null;
      else tok += c;
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === '\\' && i + 1 < str.length) {
      tok += str[++i];
      has = true;
    } else if (c === '&' || c === '|' || c === ';') {
      flush();
      if (segs[segs.length - 1].length) segs.push([]);
      if (str[i + 1] === c) i++;
    } else if (c === ' ' || c === '\t') {
      flush();
    } else {
      tok += c;
      has = true;
    }
  }
  flush();
  return segs.filter((s) => s.length);
}

function scriptKind(p) {
  const base = path.basename(p);
  return /^test_|_test\.|^runtests\./.test(base) ? 'TEST' : 'RUN';
}

function subKind(map, args) {
  const sub = args.find((a) => !a.startsWith('-'));
  const v = map[sub] ?? map['*'];
  if (v && typeof v === 'object') return subKind(v, args.slice(args.indexOf(sub) + 1));
  return v || 'OTHER';
}

function classifyTokens(t) {
  if (!t.length) return 'OTHER';
  let head = t[0];
  let args = t.slice(1);
  if (cfg.runner_wrappers.includes(head)) {
    head = args[0];
    args = args.slice(1);
    if (!head) return 'OTHER';
  }
  if (cfg.interpreters.includes(head)) {
    const m = args.indexOf('-m');
    if (m >= 0 && args[m + 1]) return cfg.heads[args[m + 1]] || 'OTHER';
    if (args.includes('-c')) return 'RUN';
    const script = args.find((a) => !a.startsWith('-'));
    return script ? scriptKind(script) : 'RUN';
  }
  if (cfg.subcommands[head]) return subKind(cfg.subcommands[head], args);
  if (cfg.heads[head]) return cfg.heads[head];
  if (head.includes('/')) return scriptKind(head);
  return 'OTHER';
}

function parts(commandString) {
  const out = [];
  for (const seg of tokenize(commandString)) {
    const t = seg.slice();
    while (t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]) || cfg.strip_prefixes.includes(t[0]))) t.shift();
    if (cfg.shell_wrappers.includes(t[0])) {
      let i = 1;
      while (i < t.length && t[i].startsWith('-')) i++;
      if (i < t.length) out.push(...parts(t[i]));
      continue;
    }
    out.push({ kind: classifyTokens(t), tokens: t });
  }
  return out;
}

function fileHas(file, needle) {
  try {
    return fs.readFileSync(file, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

function hasTestFiles(dir, depth = 3) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile() && /^test_.*\.py$|_test\.py$/.test(e.name)) return true;
    if (depth > 1 && e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
      if (hasTestFiles(path.join(dir, e.name), depth - 1)) return true;
    }
  }
  return false;
}

export function createVerifiers(repoDir, stateDir = path.join(repoDir, '.prefetch')) {
  const stateFile = path.join(stateDir, 'verifiers.json');
  let learned = {};
  try {
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (data && typeof data.learned === 'object' && data.learned) learned = data.learned;
  } catch {}

  function persist() {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmp = stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ repoDir, learned }, null, 2));
    fs.renameSync(tmp, stateFile);
  }

  return {
    classify(commandString) {
      const ps = parts(commandString);
      if (!ps.length) return null;
      let best = 'OTHER';
      for (const p of ps) {
        if (cfg.class_priority.indexOf(p.kind) < cfg.class_priority.indexOf(best)) best = p.kind;
      }
      return best;
    },
    learn(commandString, cwd) {
      const kind = this.classify(commandString);
      if (!LEARNABLE.includes(kind)) return;
      const cd = commandString.match(/^\s*cd\s+(\S+)\s*&&\s*/);
      const part = parts(cd ? commandString.slice(cd[0].length) : commandString).find((p) => p.kind === kind);
      if (!part) return;
      const cut = part.tokens.findIndex((t) => /[<>]/.test(t));
      const argv = cut === -1 ? part.tokens : part.tokens.slice(0, cut);
      if (argv.length === 0) return;
      if (!cwd) return;
      learned[kind] = { argv, cwd: cd ? path.resolve(cwd, cd[1]) : cwd };
      persist();
    },
    resolve(kind) {
      if (learned[kind]) return learned[kind];
      if (kind !== 'TEST') return null;
      if (
        fs.existsSync(path.join(repoDir, 'pytest.ini')) ||
        fileHas(path.join(repoDir, 'pyproject.toml'), '[tool.pytest') ||
        fileHas(path.join(repoDir, 'setup.cfg'), '[tool:pytest]')
      ) {
        return { argv: ['python3', '-m', 'pytest', '-q'], cwd: repoDir };
      }
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
        if (pkg.scripts && pkg.scripts.test) return { argv: ['npm', 'test'], cwd: repoDir };
      } catch {}
      if (hasTestFiles(repoDir)) return { argv: ['python3', '-m', 'unittest', 'discover'], cwd: repoDir };
      return null;
    },
  };
}
