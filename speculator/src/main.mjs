import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTransport } from './transport.mjs';
import { createExecutor } from './executor.mjs';
import { createDaemon } from './daemon.mjs';
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

export function threadParams(
  repoDir,
  baseline = process.env.SPEX_BASELINE === '1',
  sealed = process.env.SPEX_CELL_SANDBOX === '1',
) {
  return {
    cwd: repoDir,
    ...(sealed
      ? { runtimeWorkspaceRoots: [repoDir], approvalPolicy: 'never' }
      : { sandbox: 'workspace-write' }),
    serviceName: 'spex',
    dynamicTools: baseline ? [] : [PREFETCH_VERIFY],
    ...(process.env.SPEX_MODEL ? { model: process.env.SPEX_MODEL } : {}),
  };
}

export async function boot(repoDir, sinks = []) {
  const emit = createEvents(join(repoDir, '.prefetch'), sinks);
  const baseline = process.env.SPEX_BASELINE === '1';
  const sealed = process.env.SPEX_CELL_SANDBOX === '1';
  emit({ type: 'mode', baseline });
  const transport = createTransport();
  const executor = createExecutor(transport.send);
  const daemon = createDaemon({
    repoDir,
    onEvent: emit,
    executor,
    tablePath: process.env.SPEX_TABLE ?? fileURLToPath(new URL('../../data/pattern_table.json', import.meta.url)),
    enabled: !baseline && process.env.SPEX_OFF !== '1',
  });
  const router = createRouter({
    scheduler: daemon.scheduler,
    serve: daemon.serve,
    predictor: daemon.firstPredictor,
    verifiers: daemon.verifiers,
    transport,
    emit,
    daemon,
  });

  // protocol trap: dynamicTools only registers behind capabilities.experimentalApi at initialize
  await transport.send('initialize', {
    clientInfo: { name: 'spex', title: 'Spex', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  transport.notify('initialized', {});

  if (sealed) {
    const profiles = await transport.send('permissionProfile/list', { cwd: repoDir });
    const active = profiles?.data?.find(
      (profile) => profile?.id === 'spex_cell' && profile.allowed === true,
    );
    if (!active) throw new Error('benchmark cell sandbox profile is not active');
  }

  // protocol trap: thread/start takes sandbox as a plain string; the sandboxPolicy object belongs to turn/start and command/exec
  const res = await transport.send('thread/start', threadParams(repoDir, baseline, sealed));

  router.attachRoot(res.thread.id);

  return {
    daemon,
    transport,
    thread: res.thread,
    model: res.model,
    reasoningEffort: res.reasoningEffort,
    permissionProfile: res.activePermissionProfile?.id ?? res.activePermissionProfile?.extends ?? null,
  };
}

export function startTurn(transport, threadId, text, opts = {}) {
  return transport.send('turn/start', {
    threadId,
    input: [{ type: 'text', text, text_elements: [] }],
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.effort ? { effort: opts.effort } : {}),
    ...(opts.serviceTier ? { serviceTier: opts.serviceTier } : {}),
    ...(opts.permissionProfile ? { permissionProfile: opts.permissionProfile } : {}),
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
