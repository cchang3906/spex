import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const CELL_SANDBOX_PROFILE = "spex_cell";
export const CELL_SANDBOX_SCHEMA = "spex-cell-sandbox/v1";

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function inside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function tomlString(value) {
  return JSON.stringify(nonEmptyString(value, "TOML string"));
}

function canonicalPath(path) {
  const absolute = resolve(nonEmptyString(path, "forbidden read path"));
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

function pythonRuntimeReadPaths(repoPath) {
  const python = resolve(
    repoPath,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!existsSync(python)) {
    return [];
  }
  const executable = realpathSync(python);
  const cellarMarker = `${sep}Cellar${sep}`;
  const cellarIndex = executable.indexOf(cellarMarker);
  if (cellarIndex < 1) {
    return [];
  }
  const prefix = executable.slice(0, cellarIndex);
  return ["Cellar", "opt"]
    .map((name) => resolve(prefix, name))
    .filter((path) => existsSync(path));
}

function sandboxConfig({ runtimeHome, runtimeTmp, repoPath, runtimeReadPaths }) {
  const path = [
    join(repoPath, ".venv", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
  return [
    'approval_policy = "never"',
    `default_permissions = ${tomlString(CELL_SANDBOX_PROFILE)}`,
    "allow_login_shell = false",
    'web_search = "disabled"',
    "",
    "[history]",
    'persistence = "none"',
    "",
    "[shell_environment_policy]",
    'inherit = "core"',
    "ignore_default_excludes = false",
    "experimental_use_profile = false",
    `set = { HOME = ${tomlString(runtimeHome)}, TMPDIR = ${tomlString(runtimeTmp)}, TMP = ${tomlString(runtimeTmp)}, TEMP = ${tomlString(runtimeTmp)}, XDG_CACHE_HOME = ${tomlString(join(runtimeHome, ".cache"))}, PIP_CACHE_DIR = ${tomlString(join(runtimeHome, ".cache", "pip"))}, GIT_CONFIG_GLOBAL = "/dev/null", PATH = ${tomlString(path)} }`,
    "",
    `[permissions.${CELL_SANDBOX_PROFILE}]`,
    'description = "Sealed Spex benchmark cell"',
    "",
    `[permissions.${CELL_SANDBOX_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    ...runtimeReadPaths.map((path) => `${tomlString(path)} = "read"`),
    "",
    `[permissions.${CELL_SANDBOX_PROFILE}.filesystem.":workspace_roots"]`,
    '"." = "write"',
    "",
    `[permissions.${CELL_SANDBOX_PROFILE}.network]`,
    "enabled = false",
    "",
  ].join("\n");
}

function validateCommandResult(result, label) {
  if (
    !result ||
    typeof result !== "object" ||
    !Number.isInteger(result.exitCode) ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string"
  ) {
    throw new Error(`${label} returned an invalid command result`);
  }
  return result;
}

async function listenLoopback() {
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    socket.end(
      "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
    );
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  return {
    get connections() {
      return connections;
    },
    port: server.address().port,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

async function runProcess(argv, { cwd, env, signal }) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("sandbox probe aborted");
  }
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      detached: process.platform !== "win32",
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let abortError = null;
    const abort = () => {
      abortError = signal?.reason instanceof Error
        ? signal.reason
        : new Error("sandbox probe aborted");
      try {
        if (process.platform === "win32") {
          child.kill("SIGKILL");
        } else {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch (error) {
        if (error?.code !== "ESRCH") {
          rejectProcess(error);
        }
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectProcess);
    child.once("close", (exitCode, exitSignal) => {
      signal?.removeEventListener("abort", abort);
      if (abortError) {
        rejectProcess(abortError);
        return;
      }
      resolveProcess({
        exitCode,
        signal: exitSignal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export function createCellSandbox({
  repoDir,
  codexBin = process.env.CODEX_BIN || "codex",
  forbiddenReadPaths = [],
  environment = process.env,
} = {}) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new TypeError("environment must be an object");
  }
  if (!Array.isArray(forbiddenReadPaths)) {
    throw new TypeError("forbiddenReadPaths must be an array");
  }
  nonEmptyString(codexBin, "codexBin");
  const repoPath = realpathSync(resolve(nonEmptyString(repoDir, "repoDir")));
  if (!statSync(repoPath).isDirectory()) {
    throw new TypeError("repoDir must be a directory");
  }

  const venv = resolve(repoPath, ".venv");
  const runtimeParent = existsSync(venv) && statSync(venv).isDirectory()
    ? venv
    : repoPath;
  const runtimeRoot = resolve(runtimeParent, ".spex-cell-runtime");
  if (existsSync(runtimeRoot)) {
    throw new Error(`sandbox runtime path already exists: ${runtimeRoot}`);
  }

  const sandboxHome = mkdtempSync(join(tmpdir(), "spex-codex-home-"));
  let cleaned = false;
  try {
    mkdirSync(runtimeRoot, { recursive: false, mode: 0o700 });
    const runtimeHome = resolve(runtimeRoot, "home");
    const runtimeTmp = resolve(runtimeRoot, "tmp");
    const runtimeReadPaths = pythonRuntimeReadPaths(repoPath);
    mkdirSync(join(runtimeHome, ".cache", "pip"), {
      recursive: true,
      mode: 0o700,
    });
    mkdirSync(runtimeTmp, { recursive: false, mode: 0o700 });

    const sourceCodexHome = resolve(
      environment.CODEX_HOME ?? join(homedir(), ".codex"),
    );
    const sourceAuth = resolve(sourceCodexHome, "auth.json");
    if (existsSync(sourceAuth)) {
      copyFileSync(sourceAuth, resolve(sandboxHome, "auth.json"));
    }
    const configPath = resolve(sandboxHome, "config.toml");
    writeFileSync(
      configPath,
      sandboxConfig({ runtimeHome, runtimeTmp, repoPath, runtimeReadPaths }),
      { encoding: "utf8", mode: 0o600 },
    );

    const forbidden = [configPath, ...forbiddenReadPaths.map(canonicalPath)];
    const deduplicated = [...new Set(forbidden)];
    for (const path of deduplicated) {
      if (inside(repoPath, path)) {
        throw new RangeError(`forbidden read path is inside the cell workspace: ${path}`);
      }
    }
    const appServerEnvironment = Object.freeze({
      ...environment,
      CODEX_HOME: sandboxHome,
      CODEX_SQLITE_HOME: sandboxHome,
      TMPDIR: runtimeTmp,
      TMP: runtimeTmp,
      TEMP: runtimeTmp,
      SPEX_CELL_SANDBOX: "1",
    });

    async function verifyWithAppServer(request) {
      if (typeof request !== "function") {
        throw new TypeError("request must be a function");
      }
      const profiles = await request("permissionProfile/list", { cwd: repoPath });
      const loaded = profiles?.data?.find(
        (profile) => profile?.id === CELL_SANDBOX_PROFILE && profile.allowed === true,
      );
      if (!loaded) {
        throw new Error(`sandbox permission profile is not active: ${CELL_SANDBOX_PROFILE}`);
      }

      const marker = resolve(runtimeTmp, "workspace-probe");
      const targets = deduplicated.flatMap((path) => [
        existsSync(path) && statSync(path).isDirectory() ? "directory" : "file",
        path,
      ]);
      const fileProbe = validateCommandResult(
        await request("command/exec", {
          command: [
            "/bin/sh",
            "-c",
            [
              'marker="$1"',
              "shift",
              'printf workspace-ok > "$marker" || exit 60',
              '[ "$(cat "$marker")" = workspace-ok ] || exit 61',
              "while [ \"$#\" -gt 0 ]; do",
              '  kind="$1"',
              '  target="$2"',
              "  shift 2",
              '  if [ "$kind" = directory ]; then',
              '    /bin/ls -la "$target" >/dev/null 2>&1 && exit 70',
              "  else",
              '    /bin/cat "$target" >/dev/null 2>&1 && exit 71',
              "  fi",
              "done",
              "exit 0",
            ].join("\n"),
            "spex-sandbox-probe",
            marker,
            ...targets,
          ],
          cwd: repoPath,
          timeoutMs: 10_000,
        }),
        "filesystem sandbox probe",
      );
      rmSync(marker, { force: true });
      if (fileProbe.exitCode !== 0) {
        throw new Error(
          `filesystem sandbox probe failed closed-check exit=${fileProbe.exitCode}: ${fileProbe.stderr}`,
        );
      }

      const python = resolve(
        repoPath,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
      if (existsSync(python)) {
        const pythonProbe = validateCommandResult(
          await request("command/exec", {
            command: [python, "-c", "import sys; print(sys.executable)"],
            cwd: repoPath,
            timeoutMs: 10_000,
          }),
          "Python runtime sandbox probe",
        );
        if (pythonProbe.exitCode !== 0) {
          throw new Error(`sandboxed Python runtime is unavailable: ${pythonProbe.stderr}`);
        }
      }

      const curlProbe = validateCommandResult(
        await request("command/exec", {
          command: ["/usr/bin/curl", "--version"],
          cwd: repoPath,
          timeoutMs: 10_000,
        }),
        "network executable probe",
      );
      if (curlProbe.exitCode !== 0) {
        throw new Error(`network probe executable is unavailable: ${curlProbe.stderr}`);
      }

      const loopback = await listenLoopback();
      let networkProbe;
      try {
        networkProbe = validateCommandResult(
          await request("command/exec", {
            command: [
              "/usr/bin/curl",
              "--noproxy",
              "*",
              "--fail",
              "--silent",
              "--show-error",
              "--max-time",
              "2",
              `http://127.0.0.1:${loopback.port}/`,
            ],
            cwd: repoPath,
            timeoutMs: 10_000,
          }),
          "network sandbox probe",
        );
      } finally {
        await loopback.close();
      }
      if (networkProbe.exitCode === 0 || loopback.connections !== 0) {
        throw new Error("sandboxed command reached a loopback network listener");
      }

      return Object.freeze({
        schema: CELL_SANDBOX_SCHEMA,
        permissionProfile: CELL_SANDBOX_PROFILE,
        workspace: repoPath,
        filesystem: Object.freeze({
          minimalRuntimeRead: true,
          workspaceWrite: true,
          outsideWorkspaceRead: false,
        }),
        networkAccess: false,
        approvalPolicy: "never",
        webSearch: "disabled",
        probes: Object.freeze({
          workspaceReadWrite: "pass",
          forbiddenReadsBlocked: deduplicated.length,
          networkBlocked: "pass",
          pythonRuntime: "pass",
        }),
        runtimeReadPaths: Object.freeze([...runtimeReadPaths]),
        forbiddenReadPaths: Object.freeze([...deduplicated]),
      });
    }

    function wrapExecution(argv, cwd = repoPath) {
      if (
        !Array.isArray(argv) ||
        argv.length === 0 ||
        argv.some((part) => typeof part !== "string" || part.includes("\0"))
      ) {
        throw new TypeError("execution argv must be a non-empty string array");
      }
      const cwdPath = realpathSync(resolve(cwd));
      if (!inside(repoPath, cwdPath)) {
        throw new RangeError("sandboxed execution cwd escaped the cell workspace");
      }
      return Object.freeze({
        argv: Object.freeze([
          codexBin,
          "sandbox",
          "-P",
          CELL_SANDBOX_PROFILE,
          "-C",
          repoPath,
          "--",
          "/bin/sh",
          "-c",
          'cd "$1" && shift && exec "$@"',
          "spex-cell-exec",
          cwdPath,
          ...argv,
        ]),
        cwd: repoPath,
        env: appServerEnvironment,
      });
    }

    async function verifyWrappedExecution({ signal } = {}) {
      const marker = resolve(runtimeTmp, "wrapped-probe");
      const allowed = wrapExecution([
        "/bin/sh",
        "-c",
        'printf wrapped-ok > "$1" && cat "$1"',
        "spex-wrapped-probe",
        marker,
      ]);
      const allowedResult = await runProcess(allowed.argv, { ...allowed, signal });
      rmSync(marker, { force: true });
      if (allowedResult.exitCode !== 0 || allowedResult.stdout !== "wrapped-ok") {
        throw new Error(`wrapped workspace probe failed: ${allowedResult.stderr}`);
      }
      for (const path of deduplicated) {
        const blocked = wrapExecution(
          existsSync(path) && statSync(path).isDirectory()
            ? ["/bin/ls", "-la", path]
            : ["/bin/cat", path],
        );
        const result = await runProcess(blocked.argv, { ...blocked, signal });
        if (result.exitCode === 0) {
          throw new Error(`wrapped execution read forbidden path: ${path}`);
        }
      }
      const python = resolve(
        repoPath,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
      if (existsSync(python)) {
        const pythonLaunch = wrapExecution([
          python,
          "-c",
          "import sys; print(sys.executable)",
        ]);
        const pythonResult = await runProcess(
          pythonLaunch.argv,
          { ...pythonLaunch, signal },
        );
        if (pythonResult.exitCode !== 0) {
          throw new Error(`wrapped Python runtime is unavailable: ${pythonResult.stderr}`);
        }
      }
      const curl = wrapExecution(["/usr/bin/curl", "--version"]);
      const curlResult = await runProcess(curl.argv, { ...curl, signal });
      if (curlResult.exitCode !== 0) {
        throw new Error(`wrapped network probe executable is unavailable: ${curlResult.stderr}`);
      }
      const loopback = await listenLoopback();
      let networkResult;
      try {
        const network = wrapExecution([
          "/usr/bin/curl",
          "--noproxy",
          "*",
          "--fail",
          "--silent",
          "--show-error",
          "--max-time",
          "2",
          `http://127.0.0.1:${loopback.port}/`,
        ]);
        networkResult = await runProcess(network.argv, { ...network, signal });
      } finally {
        await loopback.close();
      }
      if (networkResult.exitCode === 0 || loopback.connections !== 0) {
        throw new Error("wrapped execution reached a loopback network listener");
      }
      return Object.freeze({
        filesystem: "pass",
        network: "pass",
        pythonRuntime: "pass",
      });
    }

    function cleanup() {
      if (cleaned) {
        return;
      }
      cleaned = true;
      rmSync(runtimeRoot, { force: true, recursive: true });
      rmSync(sandboxHome, { force: true, recursive: true });
    }

    return Object.freeze({
      appServerArgs: Object.freeze([
        "app-server",
        "--stdio",
        "--strict-config",
      ]),
      appServerEnvironment,
      cleanup,
      forbiddenReadPaths: Object.freeze([...deduplicated]),
      profile: CELL_SANDBOX_PROFILE,
      repoDir: repoPath,
      verifyWithAppServer,
      verifyWrappedExecution,
      wrapExecution,
    });
  } catch (error) {
    rmSync(runtimeRoot, { force: true, recursive: true });
    rmSync(sandboxHome, { force: true, recursive: true });
    throw error;
  }
}
