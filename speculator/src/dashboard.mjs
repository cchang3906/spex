import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function createDashboard(port = 7777) {
  const clients = new Set();
  const backlog = [];
  const page = readFileSync(join(here, 'dashboard.html'));
  const server = createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      for (const line of backlog) res.write(`data: ${line}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.url?.startsWith('/fonts/')) {
      // basename() collapses any traversal so this only ever serves demo/fonts/
      const file = resolve(join(here, '..', 'demo', 'fonts'), basename(req.url.slice('/fonts/'.length)));
      try {
        const f = readFileSync(file);
        res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=604800' });
        res.end(f);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(page);
  });
  server.listen(port, '127.0.0.1');
  const sink = (line) => {
    backlog.push(line);
    if (backlog.length > 500) backlog.shift();
    for (const c of clients) c.write(`data: ${line}\n\n`);
  };
  return { sink, close: () => server.close() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const dash = createDashboard();
  console.log('dashboard: http://127.0.0.1:7777');
  if (file) {
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const t0 = JSON.parse(lines[0]).t;
    let last = t0;
    (async function loop() {
      for (;;) {
        for (const line of lines) {
          const dt = Math.min(JSON.parse(line).t - last, 3000);
          last = JSON.parse(line).t;
          await new Promise((r) => setTimeout(r, Math.max(dt, 50)));
          dash.sink(line);
        }
        await new Promise((r) => setTimeout(r, 4000));
        dash.sink(JSON.stringify({ t: Date.now(), type: 'reset' }));
        last = t0;
      }
    })();
  }
}
