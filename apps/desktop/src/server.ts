import { spawn } from "node:child_process";

const OPEN_LINE = /^\[tah\] open (http:\/\/127\.0\.0\.1:(\d+)\/\?token=(\S+))$/m;
const TAIL_LINES = 20;

export class StartError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.stderr = stderr;
  }
}

export type Server = {
  readonly url: string;
  /** The folder the web app has open now; undefined when tah does not answer. */
  activeFolder(): Promise<string | undefined>;
  /** SIGINT, then SIGKILL after `stopTimeoutMs`; resolves once the process is gone. */
  stop(): Promise<void>;
};

export type ServerOptions = {
  node: string;
  cli: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Called with the last stderr lines when tah exits on its own after it started. */
  onExit(stderr: string): void;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
};

export function startServer(opts: ServerOptions): Promise<Server> {
  const child = spawn(opts.node, [opts.cli, "serve", "--cwd", opts.cwd, "--port", "0", "--no-open"], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-64_000);
  });
  const tail = () => stderr.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
  let stopping = false;

  const server = (url: string, port: string, token: string): Server => ({
    url,
    async activeFolder() {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
          headers: { cookie: `tah_token_${port}=${token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return undefined;
        const list = (await res.json()) as { path: string; active: boolean }[];
        return list.find((w) => w.active)?.path;
      } catch {
        return undefined;
      }
    },
    async stop() {
      stopping = true;
      child.kill("SIGINT");
      const timer = setTimeout(() => child.kill("SIGKILL"), opts.stopTimeoutMs ?? 5000);
      await exited;
      clearTimeout(timer);
    },
  });

  return new Promise((resolve, reject) => {
    const startTimeoutMs = opts.startTimeoutMs ?? 30_000;
    let ready = false;
    const fail = (message: string) => {
      if (ready) return;
      ready = true;
      stopping = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      void exited.then(() => reject(new StartError(message, tail())));
    };
    const timer = setTimeout(() => fail(`tah did not start within ${startTimeoutMs / 1000}s`), startTimeoutMs);
    let out = "";
    // Keep reading after the url line so a full pipe never blocks tah.
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (ready) return;
      out += chunk;
      const m = OPEN_LINE.exec(out);
      if (!m) return;
      ready = true;
      clearTimeout(timer);
      resolve(server(m[1]!, m[2]!, m[3]!));
    });
    child.once("error", (err) => fail(err.message));
    child.once("exit", (code, signal) => {
      if (!ready) fail(`tah exited (${signal ?? `code ${code}`}) before it was ready`);
      else if (!stopping) opts.onExit(tail());
    });
  });
}
