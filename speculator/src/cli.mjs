import { createInterface, emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { boot, startTurn, threadParams } from './main.mjs';

const YELLOW = '\x1b[33m';
const BLUE = '\x1b[94m'; // bright blue — reserved for reclaimed time
const CMD_BLUE = '\x1b[34m'; // codex colors command text blue in Ran chips
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function stripWrapper(command) {
  let c = String(command ?? '');
  const m = c.match(/^(?:\/\S+\/)?(?:zsh|bash|sh)\s+-l?c\s+([\s\S]+)$/);
  if (m) c = m[1];
  const q = c[0];
  if ((q === "'" || q === '"') && c.length > 1 && c.endsWith(q)) c = c.slice(1, -1);
  return c;
}

function fmtS(ms) {
  return (Math.max(0, ms ?? 0) / 1000).toFixed(1) + 's';
}

// codex-style shell highlighting: command-position words blue (git/npm/… keep their
// subcommand blue too), flags and redirects red, everything else default.
const SUBCMD = new Set(['git', 'npm', 'pnpm', 'yarn', 'cargo', 'docker', 'kubectl', 'go']);

export function shellTokens(cmd) {
  const parts = String(cmd).match(/'[^']*'|"[^"]*"|\|\||&&|[;|()]|\s+|\S+/g) ?? [];
  const toks = [];
  let expectCmd = true;
  let subCmd = false;
  for (const p of parts) {
    if (/^\s+$/.test(p)) {
      toks.push({ t: p, c: null });
    } else if (p === '||' || p === '&&' || p === ';' || p === '|' || p === '(') {
      toks.push({ t: p, c: null });
      expectCmd = true;
      subCmd = false;
    } else if (/^-/.test(p) || /^\d*[<>]/.test(p) || p.includes('>')) {
      toks.push({ t: p, c: '\x1b[31m' });
    } else if (expectCmd || subCmd) {
      toks.push({ t: p, c: CMD_BLUE });
      subCmd = expectCmd && SUBCMD.has(p);
      expectCmd = false;
    } else {
      toks.push({ t: p, c: null });
    }
  }
  return toks;
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ANSI-aware truncation: keeps escape codes, caps visible chars at max. Painted UI rows
// must never exceed the terminal width — a wrapped row breaks the cursor-up math.
export function clip(s, max) {
  let out = '';
  let vis = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z]/);
      if (m) {
        out += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (vis >= max) continue;
    out += s[i];
    vis++;
  }
  return out;
}

const KIND_ABBR = { test: 'test', lint: 'lint', typecheck: 'type', build: 'build' };

export function createRenderer(write, opts = {}) {
  if (typeof opts === 'function') opts = { now: opts };
  const now = opts.now ?? Date.now;
  const width = opts.width ?? (() => process.stdout.columns || 100);

  let open = null; // null | 'text' | 'think' | <commandExecution item id>
  let lineLen = 0; // visible chars on the open line (annotation padding needs it)
  let textCol = 0; // visible column while streaming a message (word wrap)
  let wordBuf = ''; // trailing partial word held until the next delta completes it
  let thinkSwallow = false; // after a thinking headline, drop the rest of the summary part
  let msgBlockOpen = false; // inside a streaming agentMessage block
  let sinceGap = false; // a visible line was printed since the last blank separator
  let firstMsgOfTurn = true; // codex draws a rule before every message block except the turn's first
  let lastBlock = null; // codex closes the turn with a rule only when a ruled message ends it
  let msgRuled = false;
  const specs = new Map(); // kind -> { argv, startedAt, state: running|ready|shown }
  const pendingServe = new Map(); // kind -> serve event, consumed at item/completed(dynamicToolCall)
  const stats = { hits: 0, savedMs: 0, tokens: 0 };

  function specText(kind, s) {
    return s.state === 'running'
      ? `prefetch ${kind}(${s.argv.join(' ')}) ${fmtS(now() - s.startedAt)}…`
      : `prefetch ${kind}(${s.argv.join(' ')}) done · cached`;
  }

  // cascade snapshot: rides whatever line ends next; 'ready' shows once then goes quiet
  function annSnapshot() {
    const act = [...specs.entries()].filter(([, s]) => s.state !== 'shown');
    if (act.length === 0) return null;
    let text;
    if (act.length === 1) {
      text = specText(act[0][0], act[0][1]);
    } else {
      text = act
        .map(([kind, s]) => `${KIND_ABBR[kind] ?? kind} ${s.state === 'running' ? fmtS(now() - s.startedAt) + '…' : 'done'}`)
        .join(' · ');
    }
    for (const [, s] of act) if (s.state === 'ready') s.state = 'shown';
    return DIM + text + RESET;
  }

  // close the open line, right-aligning an annotation into the remaining width.
  // ann: undefined -> cascade snapshot, false -> never annotate, string -> as given
  function closeLine(ann) {
    const a = ann === undefined ? annSnapshot() : ann;
    if (a) {
      const pad = width() - 1 - lineLen - stripAnsi(a).length;
      if (pad >= 2) write(' '.repeat(pad) + a);
      else {
        write(RESET + '\n');
        write(' '.repeat(Math.max(0, width() - 1 - stripAnsi(a).length)) + a);
      }
    }
    write(RESET + '\n');
    open = null;
    lineLen = 0;
    sinceGap = true;
  }

  // streamed message text word-wraps at the terminal edge with a 2-space hanging
  // indent, so continuation lines align under the bullet instead of snapping to col 0
  function writeWrapped(delta) {
    let s = wordBuf + delta;
    wordBuf = '';
    const tail = s.match(/[^\s]+$/);
    if (tail) {
      wordBuf = tail[0];
      s = s.slice(0, s.length - tail[0].length);
    }
    for (const tok of s.split(/(\s+)/)) {
      if (!tok) continue;
      const nl = tok.lastIndexOf('\n');
      if (nl !== -1) {
        write(tok.slice(0, nl + 1) + '  ' + tok.slice(nl + 1));
        textCol = 2 + tok.length - nl - 1;
      } else if (/\s/.test(tok)) {
        write(tok);
        textCol += tok.length;
      } else {
        if (textCol > 2 && textCol + tok.length > width() - 1) {
          write('\n  ');
          textCol = 2;
        }
        write(tok);
        textCol += tok.length;
      }
    }
  }

  function flushWord() {
    if (!wordBuf) return;
    if (textCol > 2 && textCol + wordBuf.length > width() - 1) {
      write('\n  ');
      textCol = 2;
    }
    write(wordBuf);
    textCol += wordBuf.length;
    wordBuf = '';
  }

  function endLine() {
    if (open === null) return;
    if (open === 'text') {
      flushWord();
      write('\n'); // streamed answer text wraps; padding math would lie, so no annotation
      open = null;
      lineLen = 0;
      sinceGap = true;
    } else {
      closeLine();
    }
  }

  // codex block spacing: one blank line between blocks (bullets, chips, rules);
  // sub-lines (└ output, stacked annotations) stay tight under their parent
  function gap() {
    endLine();
    if (sinceGap) {
      write('\n');
      sinceGap = false;
    }
  }

  function line(s, ann) {
    endLine();
    write(s);
    lineLen = stripAnsi(s).length;
    open = 'discrete';
    closeLine(ann);
  }

  function rule() {
    line(DIM + '─'.repeat(Math.max(1, width() - 1)) + RESET, false);
  }

  function editCounts(changes) {
    let add = 0;
    let del = 0;
    for (const c of changes ?? []) {
      for (const l of String(c?.diff ?? '').split('\n')) {
        if (l.startsWith('+') && !l.startsWith('+++')) add++;
        else if (l.startsWith('-') && !l.startsWith('---')) del++;
      }
    }
    return { add, del };
  }

  // flatten the first change's unified diff into display rows: context lines carry the
  // new-file line number, removals the old number, additions the new number (codex layout)
  function diffRows(changes) {
    const rows = [];
    for (const c of changes ?? []) {
      let oldN = 0;
      let newN = 0;
      for (const l of String(c?.diff ?? '').split('\n')) {
        if (l.startsWith('@@')) {
          const m = l.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (m) {
            oldN = Number(m[1]);
            newN = Number(m[2]);
          }
          continue;
        }
        if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ')) continue;
        if (l.startsWith('+')) rows.push({ n: newN++, mark: '+', text: l.slice(1) });
        else if (l.startsWith('-')) rows.push({ n: oldN++, mark: '-', text: l.slice(1) });
        else if (l.startsWith(' ')) {
          rows.push({ n: newN++, mark: ' ', text: l.slice(1) });
          oldN++;
        }
      }
      break; // MVP: first file only
    }
    return rows;
  }

  function shortPath(p) {
    return String(p ?? 'file').split('/').slice(-2).join('/');
  }

  function coloredExit(code) {
    if (code === null || code === undefined) return '?';
    return (code === 0 ? GREEN : RED) + code + RESET + DIM;
  }

  function firstLine(text, cap = 72) {
    return (String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '').slice(0, cap);
  }

  function renderToolCall(item) {
    gap();
    lastBlock = 'tool';
    const kind = item.arguments?.kind ?? 'test';
    const evt = pendingServe.get(kind);
    pendingServe.delete(kind);
    const text = String(item.contentItems?.[0]?.text ?? '');
    const exitMatch = text.match(/exit code: (-?\d+)/);
    const exitCode = exitMatch ? Number(exitMatch[1]) : null;
    // the tool result carries the real command output after the tail marker;
    // fall back to everything minus the header lines when the marker is absent
    const marker = text.indexOf('--- output (tail) ---');
    const body = marker === -1 ? text : text.slice(marker + 21);
    const outLines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && (marker !== -1 || !/^(verifier|exit code|duration):/.test(l)));

    if (evt && ['hit', 'reused', 'promoted', 'joined'].includes(evt.outcome)) {
      stats.hits++;
      stats.savedMs += evt.savedMs ?? 0;
      // full-row wash (mockup): olive background to the line edge; fg-only color codes
      // inside so the background survives until the trailing \x1b[K
      const left = `${YELLOW}▌\x1b[39m Called prefetch_verify(${kind})`;
      const ann = `${YELLOW}⚡ cache hit\x1b[39m\x1b[2m · \x1b[22m${BLUE}${fmtS(evt.savedMs)} saved\x1b[39m`;
      endLine();
      const pad = Math.max(2, width() - 1 - stripAnsi(left).length - stripAnsi(ann).length);
      write('\x1b[48;5;58m' + left + ' '.repeat(pad) + ann + '\x1b[K' + RESET + '\n');
      sinceGap = true;
    } else if (evt && evt.outcome === 'miss') {
      const cold = evt.epoch === 0 ? 'cold start · ' : '';
      const bullet = exitCode === null ? '•' : (exitCode === 0 ? GREEN : RED) + '•' + RESET;
      // codex durationMs is 0 on current builds; waitMs is our own clock on the miss path
      line(`${bullet} Called prefetch_verify(${kind})`, `${DIM}${cold}ran fresh ${fmtS(evt.waitMs)}${RESET}`);
    } else if (evt && evt.outcome === 'unknown') {
      line(`• Called prefetch_verify(${kind})`, `${DIM}no verifier for this repo yet${RESET}`);
      return;
    } else {
      const bullet = exitCode === null ? '•' : (exitCode === 0 ? GREEN : RED) + '•' + RESET;
      line(`${bullet} Called prefetch_verify(${kind})`, false);
    }
    // real output under └, codex style: a few lines aligned, then a dim truncation notice
    const cap = Math.max(20, width() - 6);
    if (exitCode !== null || outLines.length) {
      line(`  ${DIM}└ ${exitCode !== null ? `exit ${coloredExit(exitCode)} · ` : ''}${(outLines[0] ?? '').slice(0, cap)}`, false);
      for (const l of outLines.slice(1, 4)) line(`    ${DIM}${l.slice(0, cap)}${RESET}`, false);
      if (outLines.length > 4) line(`    ${DIM}… +${outLines.length - 4} lines${RESET}`, false);
    }
  }

  function onMessage(msg) {
    const method = msg?.method;
    const params = msg?.params;
    if (method === undefined) return;

    if (method === 'item/agentMessage/delta' && typeof params?.delta === 'string') {
      if (!msgBlockOpen) {
        gap();
        msgRuled = !firstMsgOfTurn;
        if (!firstMsgOfTurn) {
          rule(); // codex separates message blocks with a rule
          gap();
        }
        firstMsgOfTurn = false;
        msgBlockOpen = true;
        lastBlock = 'msg';
        write(DIM + '•' + RESET + ' '); // codex: dim message bullet, bright text
        textCol = 2;
      } else if (open !== 'text') {
        endLine();
        write('  '); // message resumes after an interposed block: keep the hanging indent
        textCol = 2;
      }
      writeWrapped(params.delta);
      open = 'text';
      return;
    }

    if (method === 'item/reasoning/summaryTextDelta') {
      const delta = params?.delta;
      if (typeof delta !== 'string' || thinkSwallow) return;
      if (open !== 'think') {
        gap();
        write(DIM + ITALIC + '• Thinking… ');
        open = 'think';
        lastBlock = 'think';
        lineLen = 12;
      }
      const nl = delta.indexOf('\n');
      const chunk = (nl === -1 ? delta : delta.slice(0, nl)).replace(/\n/g, ' ');
      write(chunk);
      lineLen += chunk.length;
      if (nl !== -1) {
        closeLine();
        thinkSwallow = true; // headline only; drop the rest of this summary part
      }
      return;
    }
    if (method === 'item/reasoning/summaryPartAdded') {
      thinkSwallow = false;
      if (open === 'think') closeLine();
      return;
    }

    const item = params?.item;
    if (method === 'item/completed' && item?.type === 'reasoning') {
      thinkSwallow = false;
      if (open === 'think') closeLine();
      return;
    }
    if (method === 'item/completed' && item?.type === 'agentMessage') {
      endLine();
      msgBlockOpen = false;
      return;
    }

    // chips render at completion only: the status-colored bullet needs the exit code,
    // and codex's transcript shows finished cells (the Working line covers the running phase)
    if (method === 'item/completed' && item?.type === 'commandExecution') {
      gap();
      lastBlock = 'cmd';
      const bad = item.exitCode !== 0 && item.exitCode !== null && item.exitCode !== undefined;
      const bullet = item.exitCode === null || item.exitCode === undefined ? '•' : (bad ? RED : GREEN) + '•' + RESET;
      // syntax-highlighted command, wrapped codex-style: continuations under a dim │ bar,
      // at most 2 visual rows, then a truncation notice counting the hidden lines
      const physical = stripWrapper(item.command).split('\n');
      const rows = [];
      let overflow = false;
      layout: for (let pi = 0; pi < physical.length; pi++) {
        if (rows.length >= 2) {
          overflow = true;
          break;
        }
        let cur = { ansi: '', vis: 0 };
        rows.push(cur);
        for (const tok of shellTokens(physical[pi])) {
          const room = () => Math.max(24, width() - 1) - (rows[0] === cur ? 6 : 4);
          if (cur.vis + tok.t.length > room()) {
            if (rows.length >= 2 || tok.t.length > room()) {
              overflow = true;
              break layout;
            }
            cur = { ansi: '', vis: 0 };
            rows.push(cur);
            if (/^\s+$/.test(tok.t)) continue;
          }
          cur.ansi += tok.c ? tok.c + tok.t + '\x1b[39m' : tok.t;
          cur.vis += tok.t.length;
        }
      }
      const chipAnn = (i) => (i === rows.length - 1 && !overflow ? undefined : false);
      line(`${bullet} ${BOLD}Ran${RESET} ${rows[0].ansi}`, chipAnn(0));
      for (let i = 1; i < rows.length; i++) line(`  ${DIM}│${RESET} ${rows[i].ansi}`, chipAnn(i));
      if (overflow) {
        line(`  ${DIM}│ … ${physical.length > 2 ? `+${physical.length - 2} lines` : ''}${RESET}`, undefined);
      }
      // codex shows a few output lines aligned under └, then a dim truncation notice;
      // no exit text — the bullet color carries pass/fail
      const cap = Math.max(20, width() - 6);
      const outLines = String(item.aggregatedOutput ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      if (!outLines.length && bad) outLines.push(`exit ${item.exitCode}`);
      if (outLines.length) {
        line(`  ${DIM}└ ${outLines[0].slice(0, cap)}`, false);
        for (const l of outLines.slice(1, 4)) line(`    ${DIM}${l.slice(0, cap)}${RESET}`, false);
        if (outLines.length > 4) line(`    ${DIM}… +${outLines.length - 4} lines${RESET}`, false);
      }
      return;
    }

    if (method === 'item/completed' && item?.type === 'fileChange') {
      gap();
      lastBlock = 'edit';
      const { add, del } = editCounts(item.changes);
      const counts = add + del > 0 ? ` (${GREEN}+${add}${RESET} ${RED}−${del}${RESET})` : '';
      const left = `${DIM}•${RESET} ${BOLD}Edited${RESET} ${shortPath(item.changes?.[0]?.path)}${counts}`;
      const running = [...specs.entries()].filter(([, s]) => s.state === 'running');
      if (running.length <= 1) {
        line(left, undefined);
      } else {
        // spawn moment with multiple slots: full argv per slot, stacked; cascade compacts after
        line(left, DIM + specText(running[0][0], running[0][1]) + RESET);
        for (const [kind, s] of running.slice(1)) line('', DIM + specText(kind, s) + RESET);
      }
      // diff body, codex-style: dim line numbers, red/green washed rows painted to EOL
      const rows = diffRows(item.changes);
      if (rows.length) {
        const numW = Math.max(...rows.map((r) => String(r.n).length)) + 2;
        const cap = Math.max(20, width() - numW - 5);
        for (const r of rows.slice(0, 8)) {
          const num = String(r.n).padStart(numW);
          const code = r.text.slice(0, cap);
          if (r.mark === '+') line(`\x1b[48;5;22m\x1b[2m${num}\x1b[22m \x1b[38;5;114m+  ${code}\x1b[39m\x1b[K`, false);
          else if (r.mark === '-') line(`\x1b[48;5;52m\x1b[2m${num}\x1b[22m \x1b[38;5;174m-  ${code}\x1b[39m\x1b[K`, false);
          else line(`${DIM}${num}    ${code}${RESET}`, false);
        }
        if (rows.length > 8) line(`${' '.repeat(numW)} ${DIM}… +${rows.length - 8} lines${RESET}`, false);
      }
      return;
    }

    if (method === 'item/completed' && item?.type === 'dynamicToolCall' && item.tool === 'prefetch_verify') {
      renderToolCall(item);
      return;
    }

    if (method === 'turn/completed' || method === 'turn/failed') {
      endLine();
      // codex brackets the turn's final answer with rules when earlier blocks preceded it
      if (lastBlock === 'msg' && msgRuled) {
        gap();
        rule();
      }
      msgBlockOpen = false;
      firstMsgOfTurn = true;
      msgRuled = false;
      lastBlock = null;
      if (sinceGap) write('\n');
      sinceGap = false;
    }
  }

  function onEvent(evt) {
    if (evt?.type === 'speculate') {
      specs.set(evt.kind, { argv: evt.argv ?? [], startedAt: evt.t ?? now(), state: 'running' });
    } else if (evt?.type === 'ready') {
      const s = specs.get(evt.kind);
      if (s && s.state === 'running') s.state = 'ready';
    } else if (evt?.type === 'outcome') {
      specs.delete(evt.kind);
    } else if (evt?.type === 'serve') {
      pendingServe.set(evt.kind, evt);
    } else if (evt?.type === 'tokens') {
      stats.tokens = evt.total ?? stats.tokens;
    }
  }

  return { onMessage, onEvent, stats: () => ({ ...stats }) };
}

// commands mirror codex's palette (researched from the codex 0.144.6 binary), in codex's
// order with codex's own descriptions. Commands whose action maps onto the app-server
// protocol are wired for real; TUI-config ones answer honestly instead of pretending.
export const SLASH_COMMANDS = [
  { name: '/model', desc: 'choose what model and reasoning effort to use' },
  { name: '/fast', desc: '1.5x speed, increased usage' },
  { name: '/ide', desc: 'include current selection, open files, and other context from your IDE' },
  { name: '/permissions', desc: 'choose what Codex is allowed to do' },
  { name: '/keymap', desc: 'remap TUI shortcuts' },
  { name: '/vim', desc: 'toggle Vim mode for the composer' },
  { name: '/experimental', desc: 'toggle experimental features' },
  { name: '/approve', desc: 'approve one retry of a recent auto-review denial' },
  { name: '/memories', desc: 'configure memory use and generation' },
  { name: '/skills', desc: 'use skills to improve how Codex performs specific tasks' },
  { name: '/import', desc: 'import setup, this project, and recent chats from Claude Code' },
  { name: '/hooks', desc: 'view and manage lifecycle hooks' },
  { name: '/review', desc: 'review my current changes and find issues' },
  { name: '/rename', desc: 'rename the current thread' },
  { name: '/new', desc: 'start a new chat during a conversation' },
  { name: '/archive', desc: 'archive this session and exit' },
  { name: '/delete', desc: 'permanently delete this session and exit' },
  { name: '/init', desc: 'create an AGENTS.md file with instructions for Codex' },
  { name: '/compact', desc: 'summarize conversation to prevent hitting the context limit' },
  { name: '/diff', desc: 'show git diff (including untracked files)' },
  { name: '/status', desc: 'show current session configuration and token usage' },
  { name: '/usage', desc: 'view account usage or use a usage limit reset' },
  { name: '/clear', desc: 'clear the terminal' },
  { name: '/quit', desc: 'exit spex' },
  { name: '/exit', desc: 'exit spex' },
];

const BAND = '\x1b[48;5;236m';
const DIM_OFF = '\x1b[22m';
const PLACEHOLDER = 'describe a task, or / for commands';

// raw-mode prompt block mirroring codex: blank line, full-width lit input band,
// dropdown rows, then a status row (model · path on the left, cache stats right).
// cursor control stays inside this block; the transcript above remains append-only.
const MENU_ROWS = 8; // codex shows a scrolling window of ~8 rows

export function createSlashPrompt({
  write,
  commands = SLASH_COMMANDS,
  statusLine = () => ({ left: '', right: '' }),
  width = () => process.stdout.columns || 100,
  onSubmit,
  onCommand,
  onQuit,
  onInterrupt = () => {},
}) {
  let buf = '';
  let idx = 0;
  let shown = false;
  let deferred = null; // slash command submitted while hidden; runs when the prompt returns
  let picker = null; // { items, idx, title, subtitle, lines, resolve } while a select list is open

  function matches() {
    if (!buf.startsWith('/') || buf.includes(' ')) return [];
    return commands.filter((c) => c.name.startsWith(buf.trimEnd()));
  }

  const padRow = BAND + '\x1b[K' + RESET; // band-colored blank row (codex pads the band)
  let lastInputVis = 0; // visible chars painted on the input row (resize repair needs it)

  function draw(first = false) {
    if (!shown) return;
    const W = Math.max(24, width());
    const m = matches();
    if (idx >= m.length) idx = 0;
    let s = first ? '\n' + padRow + '\n' : '';
    s += '\r\x1b[0J';
    // input band: background painted to end of line via \x1b[K; long input shows its tail
    const shownBuf = buf.slice(-(W - 5));
    lastInputVis = 3 + (buf.length ? shownBuf.length : PLACEHOLDER.length);
    s += BAND + ' › ' + (buf.length ? shownBuf : clip(DIM + PLACEHOLDER + DIM_OFF, W - 4)) + '\x1b[K' + RESET;
    s += '\n' + padRow;
    // scrolling window keeps the selection visible without overflowing short terminals
    const off = Math.max(0, Math.min(idx - MENU_ROWS + 1, m.length - MENU_ROWS));
    const view = m.slice(off, off + MENU_ROWS);
    if (view.length) {
      s += '\n'; // codex spacing: gap between the band and the menu
      for (let i = 0; i < view.length; i++) {
        const sel = off + i === idx;
        const row = sel ? ' ' + BOLD + view[i].name.padEnd(15) + view[i].desc + RESET : ' ' + view[i].name.padEnd(15) + DIM + view[i].desc + RESET;
        s += '\n' + clip(row, W - 1);
      }
    }
    // status row docks directly under the band (codex: no blank separator);
    // model+path left, cache stats right-aligned to the terminal edge
    const st = statusLine();
    const pad = W - 2 - stripAnsi(st.left).length - stripAnsi(st.right).length;
    s += '\n' + clip(' ' + st.left + (pad >= 2 ? ' '.repeat(pad) : DIM + ' · ' + RESET) + st.right, W - 1);
    const below = 1 + (view.length ? 1 + view.length : 0) + 1;
    s += `\x1b[${below}A\r\x1b[${3 + (buf.length ? shownBuf.length : 0)}C`;
    write(s);
  }

  function show() {
    shown = true;
    if (deferred) {
      const text = deferred;
      deferred = null;
      buf = text;
      write('\n' + padRow + '\n'); // commitLine expects the band pad row above to exist
      submit();
      return;
    }
    draw(true);
  }

  function hide() {
    if (!shown) return;
    write('\x1b[1A\r\x1b[0J'); // cursor sits on the input row; the band pad row is one above
    shown = false;
  }

  // submitted lines echo as a padded lit band block, codex style, with a blank line after
  function commitLine(s) {
    // the pad row above is already painted; replace the input row down with the echo
    write('\r\x1b[0J' + BAND + ' › ' + s + '\x1b[K' + RESET + '\n' + padRow + '\n\n');
    buf = '';
    idx = 0;
    shown = false;
  }

  // codex-style select list (e.g. /model): bordered panel, numbered rows, › cursor,
  // enter confirms, esc goes back, digits jump. Resolves the chosen index, or null on esc.
  function drawPicker(first = false) {
    const p = picker;
    p.w = Math.max(24, width()); // paint width — resize repair estimates re-wrapping from it
    const inner = Math.max(20, p.w - 2);
    const nameW = Math.max(...p.items.map((it, i) => `${i + 1}. ${it.name}`.length)) + 2;
    const row = (content) => {
      const c = clip(content, inner - 2);
      const vis = stripAnsi(c).length;
      return DIM + '│' + RESET + ' ' + c + ' '.repeat(Math.max(0, inner - 2 - vis)) + ' ' + DIM + '│' + RESET;
    };
    const body = [BOLD + p.title + RESET];
    if (p.subtitle) body.push(DIM + p.subtitle + RESET);
    body.push('');
    for (let i = 0; i < p.items.length; i++) {
      const num = `${i + 1}. ${p.items[i].name}`.padEnd(nameW);
      body.push(
        i === p.idx
          ? BOLD + '› ' + num + p.items[i].desc + RESET
          : DIM + '  ' + num + p.items[i].desc + RESET,
      );
    }
    body.push('', DIM + 'Press enter to confirm or esc to go back' + RESET);
    const lines = [DIM + '╭' + '─'.repeat(inner) + '╮' + RESET, ...body.map(row), DIM + '╰' + '─'.repeat(inner) + '╯' + RESET];
    let s = first ? '\x1b[?25l' : `\x1b[${p.lines - 1}A\r\x1b[0J`;
    p.lines = lines.length;
    write(s + lines.join('\n'));
  }

  function endPick(value) {
    const p = picker;
    picker = null;
    write(`\x1b[${p.lines - 1}A\r\x1b[0J\x1b[?25h`);
    p.resolve(value);
  }

  function pick({ title, subtitle, items, initial = 0 }) {
    return new Promise((resolve) => {
      if (!items?.length) return resolve(null);
      if (shown) hide();
      picker = { title, subtitle, items, idx: Math.min(Math.max(0, initial), items.length - 1), lines: 0, resolve };
      drawPicker(true);
    });
  }

  function pickerKey(str, key) {
    const p = picker;
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return endPick(null);
    if (key.name === 'return' || key.name === 'enter') return endPick(p.idx);
    if (key.name === 'up' || key.name === 'down') {
      p.idx = (p.idx + (key.name === 'down' ? 1 : p.items.length - 1)) % p.items.length;
      return drawPicker();
    }
    if (typeof str === 'string' && /^[1-9]$/.test(str) && Number(str) <= p.items.length) {
      p.idx = Number(str) - 1;
      drawPicker();
    }
  }

  // window resize: previously painted rows may have re-wrapped; clear the input area
  // wrap-aware (physical height estimated from the paint width) and repaint fresh
  function onResize() {
    const W = Math.max(24, width());
    if (picker) {
      const per = Math.max(1, Math.ceil((picker.w ?? W) / W));
      write(`\x1b[${Math.max(1, picker.lines * per - 1)}A\r\x1b[0J`);
      drawPicker(true);
      return;
    }
    if (shown) {
      const extra = Math.max(0, Math.ceil(lastInputVis / W) - 1);
      write(`\x1b[${1 + extra}A\r\x1b[0J` + padRow + '\n');
      draw();
    }
  }

  function submit() {
    const text = buf.trim();
    if (text.startsWith('/')) {
      const [name, ...args] = text.split(/\s+/);
      const exact = commands.find((c) => c.name === name);
      const m = matches();
      const cmd = exact ?? (m.length ? m[idx] : null);
      if (cmd) {
        commitLine(cmd.name + (args.length ? ' ' + args.join(' ') : ''));
        onCommand(cmd.name, args);
      } else {
        commitLine(buf);
        write(DIM + 'unknown command: ' + text + RESET + '\n');
        show();
      }
      return;
    }
    if (!text) {
      draw();
      return;
    }
    commitLine(buf);
    onSubmit(text);
  }

  function onKeypress(str, key = {}) {
    if (picker) return pickerKey(str, key);
    if (key.ctrl && key.name === 'c') {
      if (shown && buf) {
        buf = '';
        idx = 0;
        draw();
      } else onQuit();
      return;
    }
    if (key.name === 'escape') {
      if (shown) {
        buf = '';
        idx = 0;
        draw();
      } else onInterrupt(); // codex: esc interrupts the running turn
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      if (shown) submit();
      else {
        const text = buf.trim();
        buf = '';
        if (!text) return;
        if (text.startsWith('/')) deferred = text; // typed ahead: command runs when the prompt returns
        else onSubmit(text); // typed ahead during a turn: queue silently
      }
      return;
    }
    if (key.name === 'backspace') {
      buf = buf.slice(0, -1);
      idx = 0;
      draw();
      return;
    }
    if (key.name === 'up' || key.name === 'down') {
      const m = matches();
      if (m.length) {
        idx = (idx + (key.name === 'down' ? 1 : m.length - 1)) % m.length;
        draw();
      }
      return;
    }
    if (key.name === 'tab') {
      const m = matches();
      if (m.length) {
        buf = m[idx].name;
        draw();
      }
      return;
    }
    if (typeof str === 'string' && !key.ctrl && !key.meta) {
      const printable = str.replace(/[\r\n\x00-\x1f]/g, '');
      if (printable) {
        buf += printable;
        idx = 0;
        draw();
      }
    }
  }

  return { show, hide, onKeypress, pick, onResize };
}

export function shortDir(dir) {
  const home = homedir();
  return dir.startsWith(home) ? '~' + dir.slice(home.length) : dir;
}

export function headerBox(model, dir, cols = process.stdout.columns || 100) {
  const rows = [
    `\x1b[1m>_ spex\x1b[0m ${DIM}(v0.1.0)${RESET}`,
    '',
    `${DIM}model:${RESET}     ${model ?? 'default'}`,
    `${DIM}directory:${RESET} ${shortDir(dir)}`,
  ];
  const inner = Math.min(Math.max(...rows.map((r) => stripAnsi(r).length)) + 2, cols - 2);
  const pad = (r) => {
    const visible = stripAnsi(r).length;
    return '│ ' + r + ' '.repeat(Math.max(0, inner - 2 - visible)) + ' │';
  };
  return ['╭' + '─'.repeat(inner) + '╮', ...rows.map(pad), '╰' + '─'.repeat(inner) + '╯'].join('\n') + '\n';
}

const AGENTS_TPL = `## Verification
This workspace provides a \`prefetch_verify\` tool. Whenever you need to run tests, lint,
typechecking, or a build to verify your changes, ALWAYS call \`prefetch_verify\` with the
appropriate kind instead of running those commands in the terminal. It executes the exact same
command in the same sandbox and returns the exit code and output — usually much faster, because
the result may already be prepared. For all other commands, use the terminal normally.
After editing code, verify with \`prefetch_verify(kind="test")\` before concluding.
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoDir = resolve(process.argv[2] ?? process.cwd());
  const interactive = process.stdin.isTTY && process.stdout.isTTY;

  // writer wrapper: keeps the live "Working" line at the bottom while the turn runs
  const out = (s) => process.stdout.write(s);
  let lastCh = '\n';
  let workingDrawn = false;
  let workingFrame = 0;
  let turnStartAt = 0;
  let ticker = null;
  const write = (s) => {
    if (!s) return;
    if (workingDrawn) {
      out('\x1b[1A\r\x1b[0J'); // remove the Working line and its padding row above
      workingDrawn = false;
    }
    out(s);
    lastCh = s[s.length - 1];
  };

  // smooth shimmer: a graduated brightness wave (grey ramp up to near-white) slides
  // across the bolded word in half-character steps; the 80ms tick keeps motion fluid
  function drawWorking() {
    if (!busy || !interactive || (!workingDrawn && lastCh !== '\n')) return;
    workingFrame++;
    const word = 'Working';
    const RAMP = ['\x1b[38;5;231m', '\x1b[38;5;250m', '\x1b[38;5;245m'];
    const BASE = '\x1b[38;5;240m';
    const span = word.length + 6; // wave slides fully off before re-entering
    const pos = ((workingFrame * 0.5) % span) - 3;
    let w = BOLD;
    for (let j = 0; j < word.length; j++) {
      const d = Math.abs(j - pos);
      w += (d < 1 ? RAMP[0] : d < 2 ? RAMP[1] : d < 3 ? RAMP[2] : BASE) + word[j];
    }
    w += RESET;
    const secs = Math.round((Date.now() - turnStartAt) / 1000);
    const line = DIM + '• ' + RESET + w + DIM + ` (${secs}s · esc to interrupt)` + RESET;
    // codex pads the Working line with a blank row above; redraws stay in place
    out(workingDrawn ? '\r\x1b[0J' + line : '\n' + line);
    workingDrawn = true;
  }

  const renderer = createRenderer(write);
  const sinks = [
    (l) => {
      try {
        renderer.onEvent(JSON.parse(l));
      } catch {}
    },
  ];
  if (process.env.SPEX_DASH) {
    const { createDashboard } = await import('./dashboard.mjs');
    sinks.push(createDashboard().sink);
    out('dashboard: http://127.0.0.1:7777\n');
  }
  const booted = await boot(repoDir, sinks);
  const transport = booted.transport;
  let thread = booted.thread;
  let model = booted.model;
  let effort = booted.reasoningEffort;
  let permissionProfile = booted.permissionProfile;
  transport.onMessage(renderer.onMessage);

  const queue = [];
  let busy = false;
  let submitHook = null; // one-shot: next submitted text is consumed by a command (e.g. custom review)
  const turnOpts = {};

  function statsRight() {
    const { hits, savedMs } = renderer.stats();
    return `${YELLOW}⚡ ${hits} cache${hits === 1 ? '' : 's'} hit${RESET}${DIM} · ${RESET}${BLUE}${fmtS(savedMs)} saved${RESET}`;
  }

  // codex status row: model+effort in dark yellow, absolute path in green on the left,
  // cache stats right-aligned to the terminal edge (draw() does the alignment)
  function statusRow() {
    const eff = turnOpts.effort ?? effort;
    const m = `${turnOpts.model ?? model ?? 'default'}${eff ? ' ' + eff : ''}`;
    return {
      left: `\x1b[38;5;136m${m}${RESET}${DIM} · ${RESET}${GREEN}${repoDir}${RESET}`,
      right: statsRight(),
    };
  }

  function shutdown() {
    write('\n');
    if (ticker) clearInterval(ticker);
    if (interactive) {
      out('\x1b[?25h'); // in case a picker hid the cursor
      process.stdin.setRawMode(false);
    }
    transport.close();
    process.exit(0);
  }

  function clearScreen() {
    write('\x1b[2J\x1b[3J\x1b[H');
    write(headerBox(turnOpts.model ?? model, repoDir));
  }

  let showPrompt = () => {};
  let hidePrompt = () => {};
  let pickList = null;

  function setBusy(b) {
    busy = b;
    if (!interactive) return;
    if (b) {
      turnStartAt = Date.now();
      workingFrame = 0;
      ticker = setInterval(drawWorking, 80);
    } else if (ticker) {
      clearInterval(ticker);
      ticker = null;
      if (workingDrawn) {
        out('\x1b[1A\r\x1b[0J');
        workingDrawn = false;
      }
    }
  }

  function pump() {
    if (busy) return;
    if (queue.length === 0) {
      showPrompt();
      return;
    }
    setBusy(true);
    hidePrompt();
    startTurn(transport, thread.id, queue.shift(), turnOpts).catch((e) => {
      setBusy(false);
      write(String(e?.message ?? e) + '\n');
      pump();
    });
  }

  transport.onMessage((msg) => {
    // server-initiated turns (compact, review) also get the Working line
    if (msg?.method === 'turn/started' && !busy) {
      hidePrompt();
      setBusy(true);
    }
    if (msg?.method === 'turn/completed' || msg?.method === 'turn/failed') {
      setBusy(false);
      pump();
    }
  });

  function print(s) {
    write(DIM + s + RESET + '\n');
  }

  function gitLines(args) {
    return new Promise((res) => {
      execFile('git', args, { cwd: repoDir }, (err, stdout) => {
        res(err ? [] : String(stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean));
      });
    });
  }

  async function startReview(target) {
    try {
      await transport.send('review/start', { threadId: thread.id, target, delivery: 'inline' });
    } catch (e) {
      print(`review failed: ${e?.message ?? e}`);
    }
  }

  // codex names/descriptions for the app-server's permission profiles (list returns bare ids)
  const PERMISSION_PROFILES = {
    ':read-only': {
      name: 'Read Only',
      desc: 'Codex can read files in the current workspace. Approval is required to edit files or access the internet.',
    },
    ':workspace': {
      name: 'Default',
      desc: 'Codex can read and edit files in the current workspace, and run commands. Approval is required to access the internet or edit other files.',
    },
    ':danger-full-access': {
      name: 'Full Access',
      desc: 'Codex can edit files outside this workspace and access the internet without asking for approval. Exercise caution when using.',
    },
  };

  async function runCommand(cmd, args) {
    if (cmd === '/quit' || cmd === '/exit') return shutdown();
    if (cmd === '/clear') {
      clearScreen();
    } else if (cmd === '/model') {
      if (args[0]) {
        turnOpts.model = args[0];
        if (args[1]) turnOpts.effort = args[1];
        print(`model set to ${args[0]}${args[1] ? ' ' + args[1] : ''} for subsequent turns`);
      } else {
        try {
          const r = await transport.send('model/list', {});
          const models = (r.data ?? r.models ?? []).filter((m) => !m.hidden);
          const nameOf = (m) => m.id ?? m.model ?? String(m);
          if (!models.length || !pickList) {
            print(`available: ${models.map(nameOf).join(', ') || 'none'}`);
            print(`current: ${turnOpts.model ?? model ?? 'default'} — set with /model <name> [effort]`);
          } else {
            // codex flow: model picker -> effort picker; esc on effort steps back to models
            while (true) {
              const cur = turnOpts.model ?? model;
              const mi = await pickList({
                title: 'Select Model and Effort',
                subtitle: 'Access legacy models by running codex -m <model_name> or in your config.toml',
                items: models.map((m) => ({ name: nameOf(m) + (nameOf(m) === cur ? ' (current)' : ''), desc: m.description ?? '' })),
                initial: Math.max(0, models.findIndex((m) => nameOf(m) === cur)),
              });
              if (mi === null) break;
              const chosen = models[mi];
              const efforts = chosen.supportedReasoningEfforts ?? [];
              let effort = null;
              if (efforts.length) {
                const curEff = (nameOf(chosen) === cur && turnOpts.effort) || chosen.defaultReasoningEffort;
                const ei = await pickList({
                  title: 'Select Reasoning Level for ' + (chosen.displayName ?? nameOf(chosen)),
                  items: efforts.map((e) => ({ name: e.reasoningEffort + (e.reasoningEffort === curEff ? ' (current)' : ''), desc: e.description ?? '' })),
                  initial: Math.max(0, efforts.findIndex((e) => e.reasoningEffort === curEff)),
                });
                if (ei === null) continue;
                effort = efforts[ei].reasoningEffort;
              }
              turnOpts.model = nameOf(chosen);
              if (effort) turnOpts.effort = effort;
              write(`• Model changed to ${nameOf(chosen)}${effort ? ' ' + effort : ''}\n`);
              break;
            }
          }
        } catch (e) {
          print(`model/list failed: ${e?.message ?? e}`);
        }
      }
    } else if (cmd === '/fast') {
      if (turnOpts.serviceTier) {
        delete turnOpts.serviceTier;
        write('• Fast mode off\n');
      } else {
        turnOpts.serviceTier = 'priority';
        write('• Fast mode on (1.5x speed, increased usage)\n');
      }
    } else if (cmd === '/permissions') {
      try {
        const r = await transport.send('permissionProfile/list', {});
        const profiles = (r.data ?? []).filter((p) => p.allowed);
        const cur = turnOpts.permissionProfile ?? permissionProfile;
        const i = pickList
          ? await pickList({
              title: 'Select Permissions',
              subtitle: 'choose what Codex is allowed to do',
              items: profiles.map((p) => ({
                name: (PERMISSION_PROFILES[p.id]?.name ?? p.id) + (p.id === cur ? ' (current)' : ''),
                desc: PERMISSION_PROFILES[p.id]?.desc ?? p.description ?? '',
              })),
              initial: Math.max(0, profiles.findIndex((p) => p.id === cur)),
            })
          : null;
        if (i !== null) {
          turnOpts.permissionProfile = profiles[i].id;
          write(`• Permissions set to ${PERMISSION_PROFILES[profiles[i].id]?.name ?? profiles[i].id}\n`);
        }
      } catch (e) {
        print(`permissions unavailable: ${e?.message ?? e}`);
      }
    } else if (cmd === '/experimental') {
      try {
        const r = await transport.send('experimentalFeature/list', {});
        const feats = (r.data ?? []).filter((f) => f.stage === 'underDevelopment').slice(0, 12);
        if (!feats.length || !pickList) {
          print('no experimental features available');
        } else {
          const i = await pickList({
            title: 'Experimental features',
            subtitle: 'Toggle experimental features. Changes are saved to config.toml',
            items: feats.map((f) => ({ name: (f.displayName ?? f.name) + (f.enabled ? ' (on)' : ''), desc: f.description ?? f.stage })),
          });
          if (i !== null) {
            const f = feats[i];
            await transport.send('experimentalFeature/enablement/set', { name: f.name, enablement: { enabled: !f.enabled } });
            write(`• ${f.displayName ?? f.name} turned ${f.enabled ? 'off' : 'on'}\n`);
          }
        }
      } catch (e) {
        print(`experimental features unavailable: ${e?.message ?? e}`);
      }
    } else if (cmd === '/review') {
      if (!pickList) return print('review requires an interactive terminal');
      const i = await pickList({
        title: 'Select Review Target',
        subtitle: 'review my current changes and find issues',
        items: [
          { name: 'uncommitted changes', desc: 'Review the working tree: staged, unstaged, and untracked files.' },
          { name: 'against a base branch', desc: 'Review changes between the current branch and the given base branch.' },
          { name: 'a specific commit', desc: 'Review the changes introduced by a specific commit.' },
          { name: 'custom instructions', desc: 'Arbitrary instructions provided by the user.' },
        ],
      });
      if (i === 0) await startReview({ type: 'uncommittedChanges' });
      else if (i === 1) {
        const branches = await gitLines(['for-each-ref', 'refs/heads', '--format=%(refname:short)']);
        if (!branches.length) print('no local branches found');
        else {
          const b = await pickList({ title: 'Select Base Branch', items: branches.map((x) => ({ name: x, desc: '' })) });
          if (b !== null) await startReview({ type: 'baseBranch', branch: branches[b] });
        }
      } else if (i === 2) {
        const commits = await gitLines(['log', '--oneline', '-n', '9']);
        if (!commits.length) print('no commits found');
        else {
          const c = await pickList({
            title: 'Select Commit',
            items: commits.map((x) => ({ name: x.split(' ')[0], desc: x.slice(x.indexOf(' ') + 1) })),
          });
          if (c !== null) await startReview({ type: 'commit', sha: commits[c].split(' ')[0], title: commits[c].slice(commits[c].indexOf(' ') + 1) });
        }
      } else if (i === 3) {
        print('type review instructions and press enter');
        submitHook = (text) => startReview({ type: 'custom', instructions: text });
      }
    } else if (cmd === '/rename') {
      if (!args.length) print('usage: /rename <new name>');
      else {
        try {
          await transport.send('thread/name/set', { threadId: thread.id, name: args.join(' ') });
          write(`• Renamed thread to "${args.join(' ')}"\n`);
        } catch (e) {
          print(`rename failed: ${e?.message ?? e}`);
        }
      }
    } else if (cmd === '/archive') {
      try {
        await transport.send('thread/archive', { threadId: thread.id });
        write('• Archived this session — exiting\n');
        return shutdown();
      } catch (e) {
        print(`archive failed: ${e?.message ?? e}`);
      }
    } else if (cmd === '/delete') {
      const i = pickList
        ? await pickList({
            title: 'Permanently delete this session and exit?',
            items: [
              { name: 'Go back', desc: 'keep the session' },
              { name: 'Proceed', desc: 'permanently delete this session and exit' },
            ],
          })
        : null;
      if (i === 1) {
        try {
          await transport.send('thread/delete', { threadId: thread.id });
          write('• Deleted this session — exiting\n');
          return shutdown();
        } catch (e) {
          print(`delete failed: ${e?.message ?? e}`);
        }
      }
    } else if (cmd === '/skills') {
      try {
        const r = await transport.send('skills/list', { threadId: thread.id });
        const skills = (r.data ?? []).flatMap((d) => d.skills ?? []).filter((s) => s.enabled);
        if (!skills.length) print('no skills available');
        for (const s of skills.slice(0, 15)) {
          print(`${s.interface?.displayName ?? s.name} — ${s.interface?.shortDescription ?? String(s.description ?? '').slice(0, 70)}`);
        }
      } catch (e) {
        print(`skills unavailable: ${e?.message ?? e}`);
      }
    } else if (cmd === '/hooks') {
      try {
        const r = await transport.send('hooks/list', { threadId: thread.id });
        const hooks = (r.data ?? []).flatMap((d) => d.hooks ?? []);
        if (!hooks.length) print('no hooks configured');
        for (const h of hooks.slice(0, 15)) print(JSON.stringify(h).slice(0, 100));
      } catch (e) {
        print(`hooks unavailable: ${e?.message ?? e}`);
      }
    } else if (cmd === '/approve') {
      print('no recent auto-review denial to approve');
    } else if (cmd === '/ide') {
      print('IDE context requires the Codex IDE extension — not available in spex');
    } else if (cmd === '/keymap') {
      print('spex keys: enter submit · tab complete · ↑/↓ select · esc clear/interrupt · ctrl+c quit (remapping not supported)');
    } else if (cmd === '/vim') {
      print('Vim composer mode is not supported in spex');
    } else if (cmd === '/memories') {
      print('memory settings are managed by codex (config.toml) — not configurable from spex');
    } else if (cmd === '/import') {
      print('Import from Claude Code is unavailable in spex');
    } else if (cmd === '/new') {
      try {
        const res = await transport.send('thread/start', threadParams(repoDir));
        thread = res.thread;
        model = res.model ?? model;
        effort = res.reasoningEffort ?? effort;
        print(`new thread ${String(thread.id).slice(0, 8)}`);
      } catch (e) {
        print(`thread/start failed: ${e?.message ?? e}`);
      }
    } else if (cmd === '/init') {
      const p = join(repoDir, 'AGENTS.md');
      if (existsSync(p)) print('AGENTS.md already exists — left untouched');
      else {
        writeFileSync(p, AGENTS_TPL);
        print('wrote AGENTS.md with prefetch_verify steering');
      }
    } else if (cmd === '/compact') {
      try {
        await transport.send('thread/compact/start', { threadId: thread.id });
        print('compaction started');
      } catch (e) {
        print(`compact failed: ${e?.message ?? e}`);
      }
    } else if (cmd === '/diff') {
      execFile('git', ['diff', '--stat'], { cwd: repoDir }, (err, stdout) => {
        const s = (stdout ?? '').trim();
        for (const l of (s ? s.split('\n') : ['no changes']).slice(0, 20)) print(l);
        if (!busy) showPrompt();
      });
      return; // async; prompt re-shown in callback
    } else if (cmd === '/status') {
      const { hits, savedMs, tokens } = renderer.stats();
      const eff = turnOpts.effort ?? effort;
      print(`model ${turnOpts.model ?? model ?? 'default'}${eff ? ' ' + eff : ''} · thread ${String(thread.id).slice(0, 8)} · ${repoDir}`);
      print(`permissions ${PERMISSION_PROFILES[turnOpts.permissionProfile ?? permissionProfile]?.name ?? 'Default'}${turnOpts.serviceTier ? ' · fast mode on' : ''} · tokens ${tokens || 'n/a'}`);
      write(`  ${YELLOW}⚡ ${hits} cache${hits === 1 ? '' : 's'} hit${RESET}${DIM} · ${RESET}${BLUE}${fmtS(savedMs)} saved${RESET}\n`);
    } else if (cmd === '/usage') {
      try {
        const r = await transport.send('account/rateLimits/read', {});
        const rl = r.rateLimits ?? {};
        const p = rl.primary;
        if (p) {
          const win = p.windowDurationMins >= 1440 ? `${Math.round(p.windowDurationMins / 1440)}d` : `${p.windowDurationMins}m`;
          print(`${rl.planType ?? 'plan'} · ${p.usedPercent ?? 0}% of ${win} limit used · resets ${new Date(p.resetsAt * 1000).toLocaleString()}`);
        } else {
          print(JSON.stringify(r).slice(0, 300));
        }
        const rc = r.rateLimitResetCredits;
        if (rc?.availableCount) print(`${rc.availableCount} usage limit reset${rc.availableCount === 1 ? '' : 's'} available (redeem via codex /usage)`);
      } catch (e) {
        print(`usage unavailable: ${e?.message ?? e}`);
      }
    }
    if (!busy) showPrompt();
  }

  if (interactive) {
    const prompt = createSlashPrompt({
      write,
      statusLine: statusRow,
      onSubmit: (text) => {
        if (submitHook) {
          const fn = submitHook;
          submitHook = null;
          fn(text);
          return;
        }
        queue.push(text);
        pump();
      },
      onCommand: (cmd, args) => {
        runCommand(cmd, args).catch((e) => print(String(e?.message ?? e)));
      },
      onQuit: shutdown,
      onInterrupt: () => {
        if (busy) transport.send('turn/interrupt', { threadId: thread.id }).catch(() => {});
      },
    });
    showPrompt = prompt.show;
    hidePrompt = prompt.hide;
    pickList = prompt.pick;
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', prompt.onKeypress);
    // resize floods during a drag; coalesce, then clear + repaint the live input area
    let resizeTimer = null;
    process.stdout.on('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (workingDrawn) {
          out('\x1b[1A\r\x1b[0J');
          workingDrawn = false; // next tick repaints at the new width
        }
        prompt.onResize();
      }, 60);
    });
    clearScreen();
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '› ' });
    showPrompt = () => {
      const st = statusRow();
      write('\n ' + st.left + '  ' + st.right + '\n');
      rl.prompt();
    };
    rl.on('line', (input) => {
      const text = input.trim();
      if (text === '/quit' || text === '/exit') return rl.close();
      if (text) {
        queue.push(text);
        pump();
      } else if (!busy) rl.prompt();
    });
    rl.on('SIGINT', () => rl.close());
    rl.on('close', shutdown);
    write(headerBox(model, repoDir));
  }

  pump();
}
