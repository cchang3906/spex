const UNKNOWN = 'no verifier configured yet for this repo. run your verification in the terminal this once.';
const LEARNABLE = ['TEST', 'LINT', 'TYPECHECK', 'BUILD'];

function respond(text) {
  return { contentItems: [{ type: 'inputText', text }], success: true };
}

function format(argv, kind, r) {
  return `verifier: ${(argv ?? [kind]).join(' ')}\nexit code: ${r.exitCode}\nduration: ${(r.durationMs / 1000).toFixed(1)}s\n--- output (tail) ---\n\n${r.output.slice(-4000)}`;
}

export function createServe({ cache, verifiers, executor, onEvent }) {
  function emit(outcome, kind, savedMs, waitMs) {
    onEvent({ type: 'serve', kind, outcome, savedMs, waitMs, epoch: cache.epoch(), t: Date.now() });
  }

  async function handleToolCall(params) {
    const t0 = Date.now();
    const kind = params.arguments.kind;
    const vkind = kind.toUpperCase();
    const p = cache.serve(kind, t0);
    let hit = false;
    p.then(() => { hit = true; }, () => {});
    // cache.serve settles before the next tick only on its done path, a later settle means we joined a running job
    await null;
    const outcome = hit ? 'hit' : 'promoted';
    let served = null;
    try { served = await p; } catch {}
    if (served) {
      emit(outcome, kind, served.savedMs, Date.now() - t0);
      return respond(format(verifiers.resolve(vkind)?.argv, kind, served.result));
    }
    const v = verifiers.resolve(vkind);
    if (!v) {
      emit('unknown', kind, 0, Date.now() - t0);
      return respond(UNKNOWN);
    }
    const result = await executor.execute(v.argv, v.cwd).promise;
    emit('miss', kind, 0, Date.now() - t0);
    return respond(format(v.argv, kind, result));
  }

  async function onCommandCompleted(item) {
    if (item.type !== 'commandExecution') return;
    const vkind = verifiers.classify(item.command);
    if (!LEARNABLE.includes(vkind)) return;
    verifiers.learn(item.command, item.cwd);
    const kind = vkind.toLowerCase();
    if (cache.servable(kind, Date.now())) onEvent({ type: 'counterfactual', kind, epoch: cache.epoch(), t: Date.now() });
  }

  return { handleToolCall, onCommandCompleted };
}
