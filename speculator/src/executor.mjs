let seq = 0;

export function createExecutor(send) {
  return {
    execute(argv, cwd) {
      const processId = `spec-exec-${++seq}`;
      const startedAt = Date.now();
      const promise = send('command/exec', {
        cwd,
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [cwd],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
        timeoutMs: 120000,
        command: argv,
        processId,
      }).then((r) => ({
        exitCode: r.exitCode,
        output: r.stdout + r.stderr,
        durationMs: Date.now() - startedAt,
      }));
      return {
        promise,
        terminate: () => Promise.resolve(send('command/exec/terminate', { processId })).catch(() => {}),
      };
    },
  };
}
