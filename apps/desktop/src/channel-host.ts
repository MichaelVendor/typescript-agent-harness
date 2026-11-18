/**
 * Companion process: `tah channel-host` for Telegram / Slack / 飞书.
 * Same lifecycle as serve: detached process group, SIGINT then SIGKILL.
 */
import { spawn } from "node:child_process";

export type ChannelHost = {
  stop(): Promise<void>;
};

export type ChannelHostOptions = {
  node: string;
  cli: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Called if the process exits on its own after start. */
  onExit(stderr: string): void;
  stopTimeoutMs?: number;
};

export function startChannelHost(opts: ChannelHostOptions): ChannelHost {
  const child = spawn(opts.node, [opts.cli, "channel-host", "--cwd", opts.cwd], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const signalGroup = (pid: number, signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      /* ESRCH */
    }
  };
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-64_000);
  });
  // Drain stdout so the pipe never blocks.
  child.stdout.resume();
  let stopping = false;
  child.once("exit", () => {
    if (!stopping) {
      const tail = stderr.trimEnd().split("\n").slice(-20).join("\n");
      opts.onExit(tail);
    }
  });

  return {
    async stop() {
      stopping = true;
      const pid = child.pid;
      if (pid === undefined) return exited;
      signalGroup(pid, "SIGINT");
      const timer = setTimeout(() => signalGroup(pid, "SIGKILL"), opts.stopTimeoutMs ?? 5000);
      await exited;
      clearTimeout(timer);
    },
  };
}
