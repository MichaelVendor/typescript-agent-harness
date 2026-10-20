import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { shellSandboxArgv } from "./shell-sandbox.js";
import type { Tool, ToolContext } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_BYTES = 32 * 1024;

function resolveInRoot(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return resolved;
}

function resolveProgram(workspaceRoot: string, program: string): string {
  if (!program.trim()) throw new Error("program is required");
  if (path.isAbsolute(program)) return program;
  if (program.includes("/") || program.includes("\\")) {
    return resolveInRoot(workspaceRoot, program);
  }
  return program;
}

export type ExecuteCommandInput = {
  program: string;
  args?: string[];
  timeoutMs?: number;
};

export type ExecuteCommandOutput = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
};

export type ExecuteCommandOptions = {
  /** Used when a call does not pass its own `timeoutMs`. */
  timeoutMs?: number;
  /** When omitted or false, spawn the program directly. */
  sandbox?: boolean;
  platform?: NodeJS.Platform;
  homedir?: string;
  lookup?: (name: string) => string | undefined;
  realpath?: (file: string) => string;
  exists?: (file: string) => boolean;
  spawn?: typeof import("node:child_process").spawn;
};

export function lookupExecutable(name: string): string | undefined {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function resolveSandboxProgram(
  program: string,
  lookup: (name: string) => string | undefined,
  realpath: (file: string) => string,
): string | undefined {
  if (!program.includes("/") && !program.includes("\\")) {
    const found = lookup(program);
    if (found === undefined) return undefined;
    return realpath(found);
  }
  return realpath(program);
}

type SandboxLaunch = {
  file: string;
  args: string[];
  readyFile?: string;
};

function sandboxLaunch(
  root: string,
  program: string,
  args: string[],
  options: ExecuteCommandOptions,
): SandboxLaunch {
  if (!options.sandbox) return { file: program, args };

  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    throw new Error("shell sandbox is unavailable on windows");
  }
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`shell sandbox unavailable: ${platform}`);
  }

  const helperName = platform === "darwin" ? "sandbox-exec" : "bwrap";
  const lookup = options.lookup ?? lookupExecutable;
  const helper = lookup(helperName);
  if (helper === undefined) {
    throw new Error(`shell sandbox unavailable: ${helperName}`);
  }

  const realpath = options.realpath ?? realpathSync;
  const programRealpath = resolveSandboxProgram(program, lookup, realpath);
  if (programRealpath === undefined || !path.isAbsolute(programRealpath)) {
    throw new Error(`shell sandbox failed: program not found: ${program}`);
  }

  const temp = realpath(tmpdir());
  const workspace = realpath(root);
  const home = options.homedir ?? homedir();
  const readyFile = path.join(temp, `tah-sandbox-${randomBytes(8).toString("hex")}.ready`);
  const built = shellSandboxArgv({
    platform,
    workspace,
    home,
    homeRealpath: realpath(home),
    programRealpath,
    userArgs: args,
    readyFile,
    tmpdir: temp,
    exists: options.exists ?? existsSync,
  });
  return { file: helper, args: built.args, readyFile };
}

function attachCap(stream: Readable, cap: { n: number; truncated: boolean; chunks: Buffer[] }): void {
  stream.on("data", (chunk: Buffer) => {
    if (cap.n >= MAX_BYTES) {
      cap.truncated = true;
      return;
    }
    const take = chunk.subarray(0, MAX_BYTES - cap.n);
    cap.n += take.byteLength;
    if (take.byteLength < chunk.byteLength) cap.truncated = true;
    cap.chunks.push(take);
  });
}

export function executeCommandTool(
  workspaceRoot: string,
  options: ExecuteCommandOptions = {},
): Tool<ExecuteCommandInput, ExecuteCommandOutput> {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const root = path.resolve(workspaceRoot);

  return {
    name: "execute_command",
    description:
      "Run a program with the workspace as cwd. Not a shell: no pipes, globs, or redirection. Relative program paths must stay inside the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        program: {
          type: "string",
          description: "Executable name on PATH, or a path relative to the workspace",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments; do not concatenate a shell string",
        },
        timeoutMs: {
          type: "integer",
          description: `Kill the program after this many ms (default ${defaultTimeoutMs}, max ${MAX_TIMEOUT_MS}). Raise it for installs, builds, downloads, and test suites; if a result says timedOut, retry with a larger value.`,
        },
      },
      required: ["program"],
      additionalProperties: false,
    },
    async execute(input, ctx: ToolContext) {
      const program = resolveProgram(root, input.program);
      const args = input.args ?? [];
      const requested = input.timeoutMs;
      const timeoutMs =
        typeof requested === "number" && Number.isFinite(requested) && requested >= 1
          ? Math.min(requested, MAX_TIMEOUT_MS)
          : defaultTimeoutMs;

      const launch = sandboxLaunch(root, program, args, options);
      try {
        const spawnProcess = options.spawn ?? spawn;
        const child = spawnProcess(launch.file, launch.args, {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        if (!child.stdout || !child.stderr) {
          throw new Error("execute_command: expected piped stdio");
        }

        const outCap = { n: 0, truncated: false, chunks: [] as Buffer[] };
        const errCap = { n: 0, truncated: false, chunks: [] as Buffer[] };
        attachCap(child.stdout, outCap);
        attachCap(child.stderr, errCap);

        let settled = false;
        let timedOut = false;
        const finished = await new Promise<{ code: number | null; timedOut: boolean }>(
          (resolve, reject) => {
            const finish = (code: number | null) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              try {
                child.kill("SIGKILL");
              } catch {
                /* already dead */
              }
              child.stdout?.destroy();
              child.stderr?.destroy();
              resolve({
                code,
                timedOut: timedOut && !ctx.signal.aborted,
              });
            };
            const timer = setTimeout(() => {
              timedOut = true;
              finish(null);
            }, timeoutMs);
            child.on("error", (err) => {
              clearTimeout(timer);
              reject(err);
            });
            child.on("close", (code) => finish(code));
            ctx.signal.addEventListener("abort", () => finish(null), { once: true });
            if (ctx.signal.aborted) finish(null);
          },
        );

        const stdout = Buffer.concat(outCap.chunks).toString("utf8");
        const stderr = Buffer.concat(errCap.chunks).toString("utf8");
        if (launch.readyFile !== undefined && !existsSync(launch.readyFile)) {
          const line = firstNonEmptyLine(stderr);
          throw new Error(
            line ? `shell sandbox failed: ${line}` : `shell sandbox failed: exit ${finished.code}`,
          );
        }
        return {
          exitCode: finished.code,
          stdout,
          stderr,
          truncated: outCap.truncated || errCap.truncated,
          timedOut: finished.timedOut,
        };
      } finally {
        if (launch.readyFile !== undefined) {
          try {
            unlinkSync(launch.readyFile);
          } catch {
            /* ready file was never created */
          }
        }
      }
    },
  };
}
