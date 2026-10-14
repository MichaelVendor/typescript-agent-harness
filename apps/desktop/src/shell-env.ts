import { spawn } from "node:child_process";
import os from "node:os";

const BEGIN = "__TAH_ENV_BEGIN__";
const END = "__TAH_ENV_END__";

export type ShellEnv = { env: NodeJS.ProcessEnv; error?: string };

/** The `env -0` dump printed between the markers; rc files may print around it. */
export function parseEnvDump(out: string): Record<string, string> | undefined {
  const start = out.indexOf(BEGIN);
  if (start === -1) return undefined;
  const end = out.indexOf(END, start + BEGIN.length);
  if (end === -1) return undefined;
  const env: Record<string, string> = {};
  for (const entry of out.slice(start + BEGIN.length, end).split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

/** Apps opened from the Dock get a bare PATH; agent commands need the one from the user's shell rc files. */
export function loadShellEnv(
  opts: { shell?: string; base?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ShellEnv> {
  const base = opts.base ?? process.env;
  const shell = opts.shell ?? os.userInfo().shell ?? "/bin/zsh";
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ShellEnv) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // oh-my-zsh update prompts and tmux autostart would block a shell with no terminal.
    const child = spawn(shell, ["-ilc", `printf ${BEGIN}; env -0; printf ${END}`], {
      env: { ...base, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTART: "false" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ env: base, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", (err) => finish({ env: base, error: err.message }));
    child.on("close", () => {
      const env = parseEnvDump(out);
      finish(env ? { env } : { env: base, error: "the login shell printed no environment" });
    });
  });
}
