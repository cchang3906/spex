import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { boot, startTurn } from './main.mjs';

const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export function stripWrapper(command) {
  let c = String(command ?? '');
  const m = c.match(/^(?:\/\S+\/)?(?:zsh|bash|sh)\s+-l?c\s+([\s\S]+)$/);
  if (m) c = m[1];
  const q = c[0];
  if ((q === "'" || q === '"') && c.length > 1 && c.endsWith(q)) c = c.slice(1, -1);
  return c;
}

function fmtMs(ms) {
  const n = Math.max(0, Math.round(ms ?? 0));
  return n >= 1000 ? (n / 1000).toFixed(1) + 's' : n + 'ms';
}

export function createRenderer(write, now = Date.now) {
  let open = null;
  const calls = new Map();

  function endLine() {
    if (open === 'text') write('\n');
    else if (open !== null) write(RESET + '\n');
    open = null;
  }

  function line(s) {
    endLine();
    write(s + '\n');
  }

  function onMessage(msg) {
    const method = msg?.method;
    const params = msg?.params;
    if (method === undefined) return;
    if (method === 'item/tool/call' && params?.tool === 'prefetch_verify') {
      calls.set(params.arguments?.kind, now());
      return;
    }
    if (method === 'item/agentMessage/delta' && typeof params?.delta === 'string') {
      if (open !== 'text') endLine();
      write(params.delta);
      open = 'text';
      return;
    }
    const item = params?.item;
    if (method === 'item/started' && item?.type === 'commandExecution') {
      endLine();
      write(DIM + '$ ' + stripWrapper(item.command));
      open = item.id ?? 'chip';
      return;
    }
    if (method === 'item/completed' && item?.type === 'commandExecution') {
      const tail = ' · exit ' + (item.exitCode ?? '?') + ' · ' + fmtMs(item.durationMs);
      if (open !== null && open === (item.id ?? 'chip')) {
        write(tail + RESET + '\n');
        open = null;
      } else {
        line(DIM + '$ ' + stripWrapper(item.command) + tail + RESET);
      }
      return;
    }
    if (method === 'turn/completed' || method === 'turn/failed') {
      endLine();
      write('\n');
    }
  }

  function onEvent(evt) {
    if (evt?.type !== 'serve') return;
    const kind = evt.kind;
    const started = calls.get(kind);
    calls.delete(kind);
    const ms = Math.max(0, Math.round(started === undefined ? 0 : now() - started));
    if (evt.outcome === 'hit' || evt.outcome === 'promoted') {
      line(`${YELLOW}⚡ prefetch_verify(${kind}) served in ${ms}ms · hid ${Math.round(evt.savedMs ?? 0)}ms of wait${RESET}`);
    } else if (evt.outcome === 'miss') {
      line(`prefetch_verify(${kind}) ran fresh (${ms}ms)`);
    } else if (evt.outcome === 'unknown') {
      line(`prefetch_verify(${kind}) has no verifier for this repo yet`);
    }
  }

  return { onMessage, onEvent };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoDir = process.argv[2] ?? process.cwd();
  const write = (s) => process.stdout.write(s);
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
    write('dashboard: http://127.0.0.1:7777\n');
  }
  const { transport, thread } = await boot(repoDir, sinks);
  transport.onMessage(renderer.onMessage);

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  const queue = [];
  let busy = false;

  function pump() {
    if (busy) return;
    if (queue.length === 0) {
      rl.prompt();
      return;
    }
    busy = true;
    startTurn(transport, thread.id, queue.shift()).catch((e) => {
      busy = false;
      write(String(e?.message ?? e) + '\n');
      pump();
    });
  }

  transport.onMessage((msg) => {
    if (msg?.method === 'turn/completed' || msg?.method === 'turn/failed') {
      busy = false;
      pump();
    }
  });

  rl.on('line', (input) => {
    const text = input.trim();
    if (text) {
      queue.push(text);
      pump();
    } else if (!busy) {
      rl.prompt();
    }
  });

  rl.on('SIGINT', () => rl.close());
  rl.on('close', () => {
    write('\n');
    transport.close();
    process.exit(0);
  });

  write(DIM + 'spex · thread ' + thread.id + RESET + '\n');
  rl.prompt();
}
