import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function createTransport(cmd = 'codex', args = ['app-server']) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], env });
  const pending = new Map();

  function failAll(reason) {
    const err = new Error(reason);
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  }
  child.on('error', (e) => {
    console.error(`codex failed to start: ${e.message} (is codex on PATH?)`);
    failAll('codex failed to start');
  });
  child.on('exit', (code, signal) => {
    if (pending.size > 0) {
      console.error(`codex exited (${signal ?? code}) with ${pending.size} request(s) in flight`);
      failAll('codex exited');
    }
  });
  const handlers = [];
  let nextId = 1;

  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    // protocol trap: server requests (item/tool/call etc) also carry an id; only method-less messages are responses to us
    if (msg.method === undefined && msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message ?? 'rpc error'), { rpc: msg.error }));
      else p.resolve(msg.result);
      return;
    }
    for (const h of handlers) h(msg);
  });

  function write(obj) {
    child.stdin.write(JSON.stringify(obj) + '\n');
  }

  return {
    send(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write({ id, method, params });
      });
    },
    notify(method, params) {
      write({ method, params });
    },
    respond(id, result) {
      write({ id, result });
    },
    onMessage(handler) {
      handlers.push(handler);
    },
    close() {
      child.kill();
    },
  };
}
