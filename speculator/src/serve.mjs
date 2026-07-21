import { createHash } from 'node:crypto';

const UNKNOWN = 'no verifier configured yet for this repo. run your verification in the terminal this once.';
const LEARNABLE = ['TEST', 'LINT', 'TYPECHECK', 'BUILD'];

function respond(text) {
  return { contentItems: [{ type: 'inputText', text }], success: true };
}

function format(argv, kind, r) {
  return `verifier: ${(argv ?? [kind]).join(' ')}\nexit code: ${r.exitCode}\nduration: ${(r.durationMs / 1000).toFixed(1)}s\n--- output (tail) ---\n\n${r.output.slice(-4000)}`;
}

export function formatTerminalResult(result, argv = result?.argv) {
  return format(argv, 'verify', result);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function epochOf(cache) {
  return typeof cache.epoch === 'function' ? cache.epoch() : cache.epoch;
}

export function createServe({ cache, verifiers, executor, onEvent, clock = Date.now }) {
  function emit(outcome, kind, savedMs, waitMs, fields = {}) {
    onEvent({ type: 'serve', kind, outcome, savedMs, waitMs, epoch: epochOf(cache), ...fields, t: clock() });
  }

  async function run(argv, cwd) {
    if (typeof executor === 'function') {
      const started = executor({ argv, cwd });
      return started?.promise ? started.promise : started;
    }
    return executor.execute(argv, cwd).promise;
  }

  async function handleToolCall(params, context = {}) {
    const t0 = clock();
    const kind = params.arguments.kind;
    const vkind = kind.toUpperCase();

    if (typeof cache.claim === 'function' && typeof cache.commit === 'function') {
      const ticket = cache.claim({
        kind,
        epoch: epochOf(cache),
        askTime: t0,
        sessionId: context.sessionId ?? context.threadId ?? null,
      });
      if (ticket) {
        try { await ticket.ready; } catch {}
        const receipt = cache.commit(ticket);
        if (receipt) {
          const response = respond(format(verifiers.resolve(vkind)?.argv, kind, receipt.result));
          const output = Buffer.from(receipt.result?.output ?? '', 'utf8');
          emit(receipt.outcome, kind, receipt.savedMs, receipt.waitMs, {
            sessionId: context.sessionId ?? context.threadId ?? null,
            originSessionId: receipt.originSessionId,
            entryId: receipt.entryId,
            claimId: receipt.claimId,
            outputSha256: sha256(output),
            responseSha256: sha256(JSON.stringify(response)),
          });
          return response;
        }
      }
    }

    const p = cache.serve(kind, t0);
    let hit = false;
    p.then(() => { hit = true; }, () => {});
    // cache.serve settles before the next tick only on its done path, a later settle means we joined a running job
    await null;
    const outcome = hit ? 'hit' : 'promoted';
    let served = null;
    try { served = await p; } catch {}
    if (served) {
      emit(outcome, kind, served.savedMs, clock() - t0, { sessionId: context.sessionId ?? context.threadId ?? null });
      return respond(format(verifiers.resolve(vkind)?.argv, kind, served.result));
    }
    const v = verifiers.resolve(vkind);
    if (!v) {
      emit('unknown', kind, 0, clock() - t0, { sessionId: context.sessionId ?? context.threadId ?? null });
      return respond(UNKNOWN);
    }
    const result = await run(v.argv, v.cwd);
    emit('miss', kind, 0, clock() - t0, { sessionId: context.sessionId ?? context.threadId ?? null });
    return respond(format(v.argv, kind, result));
  }

  async function onCommandCompleted(item) {
    if (item.type !== 'commandExecution') return;
    const vkind = verifiers.classify(item.command);
    if (!LEARNABLE.includes(vkind)) return;
    verifiers.learn(item.command, item.cwd);
    const kind = vkind.toLowerCase();
    if (cache.servable(kind, Date.now())) onEvent({ type: 'counterfactual', kind, epoch: epochOf(cache), t: Date.now() });
  }

  return { handleToolCall, onCommandCompleted };
}
