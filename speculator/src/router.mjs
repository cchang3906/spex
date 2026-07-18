const FAIL = { contentItems: [{ type: 'inputText', text: 'verifier error' }], success: false };

function editSig(item) {
  const ext = String(item.changes?.[0]?.path ?? '').split('.').pop().toLowerCase();
  const cls = ext === 'py' || ext === 'pyi' ? 'py' : ['json', 'yaml', 'toml', 'txt', 'md'].includes(ext) ? 'config' : 'other';
  return `EDIT(${cls})`;
}

export function createRouter({ scheduler, serve, predictor, verifiers, transport, emit }) {
  function cmdSig(item) {
    const cls = verifiers.classify(item.command ?? '') || 'OTHER';
    const status = item.status === 'declined' ? 'declined' : item.exitCode === 0 ? 'passed' : 'failed';
    return `${cls}(${status})`;
  }

  const accept = (id) => transport.respond(id, { decision: 'accept' });
  // protocol trap: legacy generation uses ReviewDecision "approved", v2 uses "accept"; detect by method name
  const approve = (id) => transport.respond(id, { decision: 'approved' });

  const requests = {
    'item/tool/call': (id, params) => {
      if (params?.tool !== 'prefetch_verify') return unknown(id, 'item/tool/call:' + params?.tool);
      serve.handleToolCall(params).then(
        (r) => transport.respond(id, r),
        () => transport.respond(id, FAIL),
      );
    },
    'item/commandExecution/requestApproval': accept,
    'item/fileChange/requestApproval': accept,
    'item/permissions/requestApproval': accept,
    execCommandApproval: approve,
    applyPatchApproval: approve,
    'item/tool/requestUserInput': (id) => transport.respond(id, { answers: {} }),
  };

  function unknown(id, method) {
    emit({ type: 'warn', method, t: Date.now() });
    transport.respond(id, {});
  }

  function onMessage(msg) {
    const { method, id, params } = msg;
    if (method !== undefined && id !== undefined) {
      const handler = requests[method];
      if (handler) handler(id, params);
      else unknown(id, method);
      return;
    }
    const item = params?.item;
    if (method === 'item/started' && item?.type === 'commandExecution') {
      emit({ type: 'codex', what: 'exec', command: item.command, t: Date.now() });
      scheduler.onAuthoritativeCommandStart();
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      // protocol trap: totals nest as tokenUsage.total.totalTokens (ThreadTokenUsage -> TokenUsageBreakdown)
      const u = params?.tokenUsage?.total ?? params?.usage ?? params ?? {};
      emit({ type: 'tokens', total: u.totalTokens ?? u.total ?? 0, t: Date.now() });
      return;
    }
    if (method === 'thread/status/changed' || method === 'turn/completed') {
      emit({ type: 'codex', what: 'status', detail: params?.status ?? method, t: Date.now() });
      return;
    }
    if (method !== 'item/completed' || !item) return;
    if (item.type === 'fileChange') {
      emit({ type: 'codex', what: 'edit', path: item.changes?.[0]?.path, sig: editSig(item), t: Date.now() });
      predictor.observe(editSig(item));
      scheduler.onFileChange();
    } else if (item.type === 'commandExecution') {
      emit({ type: 'codex', what: 'done', command: item.command, exitCode: item.exitCode, durationMs: item.durationMs, t: Date.now() });
      Promise.resolve(serve.onCommandCompleted(item)).catch(() => {});
      const cmd = item.command ?? '';
      const readOnly = /^\s*(\/bin\/\w*sh\s+-l?c\s+["']?\s*)?(rg|grep|cat|ls|find|head|tail|nl|wc)\b/.test(cmd);
      const codeExt = '(py|js|ts|mjs|jsx|tsx|json|toml|ya?ml|cfg|ini|sh|c|h|cpp|go|rs|java|rb)';
      const redirects = new RegExp('>{1,2}\\s*\\S+\\.' + codeExt + '\\b').test(cmd) || new RegExp('\\btee\\s+(-a\\s+)?\\S+\\.' + codeExt + '\\b').test(cmd);
      const mutates =
        /apply_patch|\bsed -i\b|\bpatch -p\d|\bsort -o\b/.test(cmd) ||
        /\bgit (apply|checkout|restore|stash pop)\b/.test(cmd) ||
        /\b(mv|cp|rm)\s+\S/.test(cmd);
      const shellEdit = item.exitCode === 0 && (redirects || (!readOnly && mutates));
      if (shellEdit) {
        const ext = (item.command.match(/\.(py|js|ts|mjs|json|toml)\b/) ?? [])[1] ?? 'py';
        const sig = `EDIT(${ext === 'mjs' || ext === 'ts' ? 'js' : ext})`;
        emit({ type: 'codex', what: 'edit', path: null, sig, t: Date.now() });
        predictor.observe(sig);
        scheduler.onFileChange();
      } else {
        predictor.observe(cmdSig(item));
      }
    }
  }

  transport.onMessage(onMessage);
  return { onMessage };
}
