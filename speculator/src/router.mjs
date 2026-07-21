import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

const FAIL = { contentItems: [{ type: 'inputText', text: 'verifier error' }], success: false };

function toolResponse(value) {
  if (value && typeof value === 'object' && Array.isArray(value.contentItems)) return value;
  return { contentItems: [{ type: 'inputText', text: String(value ?? '') }], success: true };
}

function editSig(item) {
  const ext = String(item.changes?.[0]?.path ?? '').split('.').pop().toLowerCase();
  const cls = ext === 'py' || ext === 'pyi' ? 'py' : ['json', 'yaml', 'toml', 'txt', 'md'].includes(ext) ? 'config' : 'other';
  return `EDIT(${cls})`;
}

export function createRouter({ scheduler, serve, predictor, verifiers, transport, emit, daemon = null }) {
  let rootSessionId = null;
  const pendingThreads = new Map();

  function sessionIdFor(params = {}) {
    return params.threadId ?? params.conversationId ?? rootSessionId;
  }

  function insideWorkspace(cwd, root = false) {
    if (!daemon) return true;
    if (root && (cwd === undefined || cwd === null)) return true;
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) return false;
    try {
      const path = relative(daemon.workspace.path, realpathSync(cwd));
      return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
    } catch {
      return false;
    }
  }

  function attachKnownThreads() {
    let attached = true;
    while (attached) {
      attached = false;
      for (const thread of pendingThreads.values()) {
        const parentSessionId = thread.parentThreadId ?? null;
        const root = thread.id === rootSessionId;
        if (!insideWorkspace(thread.cwd, root)) {
          if (daemon?.hasSession(thread.id)) daemon.detachSession(thread.id);
          pendingThreads.delete(thread.id);
          attached = true;
        } else if (root || (parentSessionId && daemon?.hasSession(parentSessionId))) {
          daemon?.attachSession({ sessionId: thread.id, parentSessionId: thread.id === rootSessionId ? null : parentSessionId });
          pendingThreads.delete(thread.id);
          attached = true;
        }
      }
    }
  }

  function rememberThread(thread) {
    if (!daemon || typeof thread?.id !== 'string') return;
    pendingThreads.set(thread.id, thread);
    attachKnownThreads();
  }

  function attachHint(sessionId, parentSessionId) {
    if (!daemon || typeof sessionId !== 'string' || !daemon.hasSession(parentSessionId)) return;
    if (!daemon.hasSession(sessionId)) daemon.attachSession({ sessionId, parentSessionId });
    attachKnownThreads();
  }

  function observe(params, event) {
    if (!daemon) return null;
    const sessionId = sessionIdFor(params);
    if (!sessionId || !daemon.hasSession(sessionId)) return null;
    return Promise.resolve(daemon.observe(sessionId, { ...event, threadId: sessionId })).catch((error) => {
      emit({ type: 'warn', method: 'daemon.observe', error: error.message, sessionId, t: Date.now() });
    });
  }

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
      const sessionId = sessionIdFor(params);
      Promise.resolve().then(() => daemon
        ? daemon.handle(params.arguments, { sessionId, threadId: sessionId })
        : serve.handleToolCall(params)).then(
        (r) => transport.respond(id, toolResponse(r)),
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
    if (method === 'thread/started') {
      rememberThread(params?.thread);
      return;
    }
    if (method === 'thread/closed') {
      daemon?.detachSession(params?.threadId);
      pendingThreads.delete(params?.threadId);
      return;
    }
    const item = params?.item;
    if (['item/started', 'item/completed'].includes(method) && item?.type === 'collabAgentToolCall') {
      if (item.tool === 'spawnAgent') {
        for (const receiverThreadId of item.receiverThreadIds ?? []) attachHint(receiverThreadId, params?.threadId);
      }
      emit({ type: 'codex', what: 'collab', tool: item.tool, sessionId: sessionIdFor(params), t: Date.now() });
      return;
    }
    if (['item/started', 'item/completed'].includes(method) && item?.type === 'subAgentActivity') {
      attachHint(item.agentThreadId, params?.threadId);
      emit({ type: 'codex', what: 'subagent', activity: item.kind, sessionId: sessionIdFor(params), t: Date.now() });
      return;
    }
    if (method === 'item/started' && item?.type === 'commandExecution') {
      emit({ type: 'codex', what: 'exec', command: item.command, t: Date.now() });
      if (daemon) observe(params, { type: 'exec_begin', command: item.command, cwd: item.cwd });
      else scheduler.onAuthoritativeCommandStart();
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
      if (daemon) observe(params, { type: 'edit', changes: item.changes, sig: editSig(item) });
      else {
        predictor.observe(editSig(item));
        scheduler.onFileChange();
      }
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
        if (daemon) observe(params, { type: 'edit', changes: [], sig });
        else {
          predictor.observe(sig);
          scheduler.onFileChange();
        }
      } else {
        if (daemon) observe(params, { type: 'command', sig: cmdSig(item), command: item.command, exitCode: item.exitCode });
        else predictor.observe(cmdSig(item));
      }
    }
  }

  transport.onMessage(onMessage);
  return {
    onMessage,
    attachRoot(sessionId) {
      rootSessionId = validRoot(sessionId);
      if (!daemon.hasSession(rootSessionId)) daemon.attachSession({ sessionId: rootSessionId, parentSessionId: null });
      attachKnownThreads();
    },
  };

  function validRoot(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('root session id must be a non-empty string');
    return sessionId;
  }
}
