import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTransport } from './transport.mjs';
import { createExecutor } from './executor.mjs';
import { createCache } from './cache.mjs';
import { createVerifiers } from './verifiers.mjs';
import { createPredictor } from './predictor.mjs';
import { createScheduler } from './scheduler.mjs';
import { createServe } from './serve.mjs';
import { createEvents } from './events.mjs';
import { createRouter } from './router.mjs';

const PREFETCH_VERIFY = {
  type: 'function',
  name: 'prefetch_verify',
  description:
    "Run the project's verification commands (tests, lint, typecheck, build). Returns exit code and output identical to running the command in the terminal, often instantly.",
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['test', 'lint', 'typecheck', 'build'] },
    },
    required: ['kind'],
    additionalProperties: false,
  },
};

export async function boot(repoDir, sinks = []) {
  const emit = createEvents(join(repoDir, '.prefetch'), sinks);
  const baseline = process.env.SPEX_BASELINE === '1';
  emit({ type: 'mode', baseline });
  const transport = createTransport();
  const executor = createExecutor(transport.send);
  const cache = createCache(emit);
  const verifiers = createVerifiers(repoDir);
  const predictor = createPredictor(process.env.SPEX_TABLE ?? fileURLToPath(new URL('../../data/pattern_table.json', import.meta.url)));

  const scheduler =
    baseline || process.env.SPEX_OFF === '1'
      ? { onFileChange() {}, onSessionStart() {}, onAuthoritativeCommandStart() {} }
      : createScheduler({
          cache,
          verifiers: { resolve: (kind) => verifiers.resolve(String(kind).toUpperCase()) },
          predictor: { propose: () => predictor.propose().map(({ kind, p }) => ({ kind: kind.toLowerCase(), p })) },
          executor,
          onEvent: emit,
          allow: ['test', 'lint', 'typecheck', 'build'],
        });

  const serve = createServe({ cache, verifiers, executor, onEvent: emit });
  createRouter({
    scheduler,
    serve: baseline ? { ...serve, handleToolCall: () => Promise.reject(new Error('baseline')) } : serve,
    predictor,
    verifiers,
    transport,
    emit,
  });

  // protocol trap: dynamicTools only registers behind capabilities.experimentalApi at initialize
  await transport.send('initialize', {
    clientInfo: { name: 'spex', title: 'Spex', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  transport.notify('initialized', {});

  // protocol trap: thread/start takes sandbox as a plain string; the sandboxPolicy object belongs to turn/start and command/exec
  const { thread } = await transport.send('thread/start', {
    cwd: repoDir,
    sandbox: 'workspace-write',
    serviceName: 'spex',
    dynamicTools: baseline ? [] : [PREFETCH_VERIFY],
    ...(process.env.SPEX_MODEL ? { model: process.env.SPEX_MODEL } : {}),
  });

  scheduler.onSessionStart();

  return { transport, thread };
}

export function startTurn(transport, threadId, text) {
  return transport.send('turn/start', {
    threadId,
    input: [{ type: 'text', text, text_elements: [] }],
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoDir = process.argv[2] ?? process.cwd();
  const task = process.argv[3];
  let sinks = [(line) => console.log(line)];
  if (process.env.SPEX_DASH) {
    const { createDashboard } = await import('./dashboard.mjs');
    const dash = createDashboard();
    console.log('dashboard: http://127.0.0.1:7777');
    sinks = [...sinks, dash.sink];
  }
  const { transport, thread } = await boot(repoDir, sinks);
  console.log(`thread ${thread.id}`);
  if (task) await startTurn(transport, thread.id, task);
}
