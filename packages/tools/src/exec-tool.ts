import { spawn } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
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
};

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

      const child = spawn(program, args, {
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

      return {
        exitCode: finished.code,
        stdout: Buffer.concat(outCap.chunks).toString("utf8"),
        stderr: Buffer.concat(errCap.chunks).toString("utf8"),
        truncated: outCap.truncated || errCap.truncated,
        timedOut: finished.timedOut,
      };
    },
  };
}
