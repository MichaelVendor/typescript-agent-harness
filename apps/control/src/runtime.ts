import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type ProjectRuntime = {
  ensure(projectId: string): Promise<{ baseUrl: string }>;
  stop(projectId: string): Promise<void>;
  touch(projectId: string): void;
};

export class RuntimeNotReadyError extends Error {
  constructor(message = "runtime not ready") {
    super(message);
    this.name = "RuntimeNotReadyError";
  }
}

export type DockerRunOpts = {
  projectId: string;
  dataDir: string;
  image: string;
  secret: string;
  deepseekApiKey?: string;
  openaiApiKey?: string;
};

export type DockerExec = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export function dockerRunArgs(opts: DockerRunOpts): string[] {
  const hostDir = `${path.resolve(opts.dataDir)}/projects/${opts.projectId}/workspace`;
  const args = [
    "run",
    "-d",
    "--name",
    `tah-project-${opts.projectId}`,
    "-v",
    `${hostDir}:/workspace`,
    "-e",
    `AR_SHARED_SECRET=${opts.secret}`,
    "-e",
    `TAH_PROJECT_ID=${opts.projectId}`,
  ];
  if (opts.deepseekApiKey) args.push("-e", `DEEPSEEK_API_KEY=${opts.deepseekApiKey}`);
  if (opts.openaiApiKey) args.push("-e", `OPENAI_API_KEY=${opts.openaiApiKey}`);
  args.push(
    opts.image,
    "tah",
    "agent-host",
    "--cwd",
    "/workspace",
    "--host",
    "0.0.0.0",
    "--port",
    "7800",
    "--project-id",
    opts.projectId,
    "--yes",
  );
  return args;
}

function spawnDocker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

async function defaultHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DockerRuntimeOptions = {
  dataDir: string;
  image: string;
  secret: string;
  deepseekApiKey?: string;
  openaiApiKey?: string;
  exec?: DockerExec;
  fetchHealth?: (url: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
};

export function createDockerRuntime(opts: DockerRuntimeOptions): ProjectRuntime {
  const exec = opts.exec ?? spawnDocker;
  const fetchHealth = opts.fetchHealth ?? defaultHealth;
  const sleep = opts.sleep ?? sleepMs;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const container = (projectId: string) => `tah-project-${projectId}`;

  return {
    async ensure(projectId) {
      const name = container(projectId);
      mkdirSync(`${path.resolve(opts.dataDir)}/projects/${projectId}/workspace`, { recursive: true });
      const status = await exec(["inspect", "-f", "{{.State.Status}}", name]);
      if (status.code !== 0) {
        const runOpts: DockerRunOpts = {
          projectId,
          dataDir: opts.dataDir,
          image: opts.image,
          secret: opts.secret,
        };
        if (opts.deepseekApiKey) runOpts.deepseekApiKey = opts.deepseekApiKey;
        if (opts.openaiApiKey) runOpts.openaiApiKey = opts.openaiApiKey;
        const run = await exec(dockerRunArgs(runOpts));
        if (run.code !== 0) throw new Error(run.stderr.trim() || "docker run failed");
      } else if (status.stdout.trim() !== "running") {
        const start = await exec(["start", name]);
        if (start.code !== 0) throw new Error(start.stderr.trim() || "docker start failed");
      }
      const deadline = now() + timeoutMs;
      while (now() < deadline) {
        const inspected = await exec([
          "inspect",
          "-f",
          "{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
          name,
        ]);
        const ip = inspected.stdout.trim();
        if (ip && (await fetchHealth(`http://${ip}:7800/health`))) {
          return { baseUrl: `http://${ip}:7800` };
        }
        await sleep(200);
      }
      throw new RuntimeNotReadyError("runtime not ready");
    },
    async stop(projectId) {
      await exec(["stop", container(projectId)]);
    },
    touch() {},
  };
}

export function createFakeRuntime(): ProjectRuntime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async ensure(projectId) {
      calls.push(`ensure:${projectId}`);
      return { baseUrl: `http://fake/${projectId}` };
    },
    async stop(projectId) {
      calls.push(`stop:${projectId}`);
    },
    touch(projectId) {
      calls.push(`touch:${projectId}`);
    },
  };
}

export function sweepIdle(
  runtime: Pick<ProjectRuntime, "stop">,
  lastTouch: Map<string, number>,
  now: number,
  idleMs: number,
): void {
  for (const [projectId, touchedAt] of lastTouch) {
    if (now - touchedAt >= idleMs) {
      lastTouch.delete(projectId);
      void runtime.stop(projectId);
    }
  }
}
