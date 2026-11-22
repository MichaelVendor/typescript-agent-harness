import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApprovalAnswer } from "@typescript-agent-harness/permissions";
import type { CliFlags } from "../args.js";
import type { ChatHost, HostEvent, SessionEvent } from "../host.js";
import { addWorkspace } from "../workspaces.js";
import { addWorktree, removeWorktree } from "./worktree.js";

export type WorkerInfo = {
  id: string; // "main" or generated
  cwd: string;
  sessionId: string;
  busy: boolean;
  needsAttention: boolean;
  worktree?: { name: string; parent: string };
  dead?: boolean;
};

export type SpawnWorker = (args: { id: string; cwd: string; token: string }) => Promise<{ url: string; kill(): void }>;

export type Orchestrator = {
  readonly focusId: string;
  readonly maxBusy: number;
  list(): WorkerInfo[];
  busyCount(): number;
  focus(id: string): void;
  /** Create worktree (unless cwd given) and spawn worker. Rejects with a message usable as a 409/400 body. */
  parallel(opts: { name?: string; cwd?: string }): Promise<WorkerInfo>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  /** Stop, drop from the list, and remove the worktree if we created it. */
  remove(id: string): Promise<void>;
  /** Proxy to the worker (or the main host for `"main"`). */
  send(id: string, text: string, attachmentIds?: string[]): Promise<void>;
  cancel(id: string): Promise<void>;
  answer(id: string, approvalId: string, answer: ApprovalAnswer): Promise<void>;
  answerQuestion(id: string, questionId: string, answers: string[][]): Promise<void>;
  skipQuestion(id: string, questionId: string): Promise<void>;
  continueTurn(id: string): Promise<void>;
  compact(id: string): Promise<void>;
  queue(id: string, op: { id: string; send?: boolean; remove?: boolean }): Promise<void>;
  onEvent(listener: (workerId: string, event: HostEvent) => void): () => void;
  /** Authenticated HTTP to a spawned worker (`"main"` is not allowed). */
  fetchWorker(id: string, route: string, init?: RequestInit): Promise<Response>;
  /** Rebind main after workspace host swap (unsubscribes the closed host). */
  setMain(host: ChatHost, cwd: string): void;
  /** Kills every child worker. */
  dispose(): Promise<void>;
};

const MAIN = "main";
const READY_TIMEOUT_MS = 15_000;
const READY_RE = /\[tah-worker\] ready (\S+)/;

type Entry = {
  info: WorkerInfo;
  token: string;
  url: string;
  kill(): void;
  abort: AbortController;
  /** Set by stop/remove so a closing event stream is not reported as a crash. */
  stopping: boolean;
};

/** Real worker: `tah agent-worker --port 0`, ready line on stdout. */
function realSpawn(flags: CliFlags, homeDir: string): SpawnWorker {
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  return ({ id, cwd, token }) =>
    new Promise((resolve, reject) => {
      const args = [cli, "agent-worker", "--cwd", cwd, "--port", "0"];
      if (flags.mock) args.push("--mock");
      if (flags.yes) args.push("--yes");
      if (flags.execSet) args.push(flags.exec ? "--exec" : "--no-exec");
      if (flags.sandboxSet) args.push(flags.sandbox ? "--sandbox" : "--no-sandbox");
      const child = spawn(process.execPath, args, {
        cwd,
        env: { ...process.env, TAH_WORKER_TOKEN: token, TAH_BROWSER_PROFILE_ID: id, HOME: homeDir },
        stdio: ["ignore", "pipe", "inherit"],
      });
      let buf = "";
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error("worker did not become ready in time")), READY_TIMEOUT_MS);
      child.once("error", fail);
      child.once("exit", (code) => fail(new Error(`worker exited before ready (code ${code})`)));
      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) return; // keep draining so the pipe never blocks
        buf += chunk.toString("utf8");
        const match = READY_RE.exec(buf);
        if (!match?.[1]) return;
        settled = true;
        clearTimeout(timer);
        resolve({ url: match[1], kill: () => void child.kill("SIGTERM") });
      });
    });
}

export function createOrchestrator(opts: {
  main: ChatHost;
  mainCwd: string;
  flags: CliFlags;
  homeDir: string;
  maxBusy?: number; // default 4
  /** test seam */
  spawnWorker?: SpawnWorker;
}): Orchestrator {
  const maxBusy = opts.maxBusy ?? 4;
  const spawnWorker = opts.spawnWorker ?? realSpawn(opts.flags, opts.homeDir);
  const mainInfo: WorkerInfo = {
    id: MAIN,
    cwd: opts.mainCwd,
    sessionId: opts.main.sessionId,
    busy: false,
    needsAttention: false,
  };
  const workers = new Map<string, Entry>();
  const listeners = new Set<(id: string, event: HostEvent) => void>();
  let focusId = MAIN;
  let counter = 0;
  let mainHost = opts.main;
  let mainCwd = opts.mainCwd;
  let mainOff: () => void;

  const info = (id: string): WorkerInfo => {
    if (id === MAIN) return mainInfo;
    const entry = workers.get(id);
    if (!entry) throw new Error(`unknown worker: ${id}`);
    return entry.info;
  };

  const entryOf = (id: string): Entry => {
    if (id === MAIN) throw new Error("main is not a spawned worker");
    const entry = workers.get(id);
    if (!entry) throw new Error(`unknown worker: ${id}`);
    return entry;
  };

  const busyCount = () => [mainInfo, ...[...workers.values()].map((w) => w.info)].filter((w) => w.busy).length;

  const assertRoom = () => {
    if (busyCount() >= maxBusy) throw new Error(`too many busy workers (max ${maxBusy})`);
  };

  const handle = (id: string, event: HostEvent) => {
    const w = info(id);
    if (event.type === "session") w.sessionId = event.id;
    else if (event.type === "user") w.busy = true;
    else if (event.type === "turn.end" || event.type === "turn.error") w.busy = false;
    if (
      id !== focusId &&
      (event.type === "approval" || event.type === "question" || event.type === "turn.end" || event.type === "turn.error")
    ) {
      w.needsAttention = true;
    }
    for (const l of listeners) l(id, event);
  };

  mainOff = mainHost.on((event) => handle(MAIN, event));

  /** Connects to the worker's `/events`; resolves once subscribed, then reads in the background. */
  const subscribe = async (id: string, entry: Entry): Promise<void> => {
    const res = await fetch(`${entry.url}/events`, {
      headers: { authorization: `Bearer ${entry.token}` },
      signal: entry.abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`worker /events failed: ${res.status}`);
    const snapRes = await fetch(`${entry.url}/session`, {
      headers: { authorization: `Bearer ${entry.token}` },
      signal: entry.abort.signal,
    });
    if (snapRes.ok) {
      const snap = (await snapRes.json()) as SessionEvent;
      if (snap.type === "session" && snap.id) entry.info.sessionId = snap.id;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let at = buf.indexOf("\n\n");
          while (at !== -1) {
            const line = buf.slice(0, at).split("\n").find((l) => l.startsWith("data: "));
            buf = buf.slice(at + 2);
            if (line) {
              try {
                if (workers.get(id) === entry) handle(id, JSON.parse(line.slice("data: ".length)) as HostEvent);
              } catch {
                // malformed frame: skip
              }
            }
            at = buf.indexOf("\n\n");
          }
        }
      } catch {
        // aborted or connection reset
      }
      if (!entry.stopping && workers.get(id) === entry) {
        entry.info.dead = true;
        entry.info.busy = false;
      }
    })();
  };

  const start = async (id: string, cwd: string): Promise<Entry> => {
    const token = randomBytes(24).toString("hex");
    const spawned = await spawnWorker({ id, cwd, token });
    const existing = workers.get(id);
    const entry = (existing ?? {
      info: { id, cwd, sessionId: "", busy: false, needsAttention: false },
    }) as Entry;
    entry.token = token;
    entry.url = spawned.url;
    entry.kill = spawned.kill;
    entry.abort = new AbortController();
    entry.stopping = false;
    workers.set(id, entry);
    try {
      await subscribe(id, entry);
    } catch (err) {
      entry.stopping = true;
      entry.abort.abort();
      spawned.kill();
      if (existing) entry.info.dead = true;
      else workers.delete(id);
      throw err;
    }
    return entry;
  };

  const halt = (entry: Entry) => {
    entry.stopping = true;
    entry.abort.abort();
    entry.kill();
  };

  const post = async (id: string, route: string, body?: Record<string, unknown>): Promise<void> => {
    const entry = entryOf(id);
    if (entry.info.dead) throw new Error(`worker is stopped: ${id}`);
    const res = await fetch(`${entry.url}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${entry.token}`, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? `worker ${route} failed: ${res.status}`);
    }
  };

  /** A turn-starting call: idle targets need a free slot and count as busy right away. */
  const startsTurn = async (id: string, run: () => Promise<void>): Promise<void> => {
    const w = info(id);
    const wasBusy = w.busy;
    if (!wasBusy) {
      assertRoom();
      w.busy = true;
    }
    try {
      await run();
    } catch (err) {
      if (!wasBusy) w.busy = false;
      throw err;
    }
  };

  return {
    get focusId() {
      return focusId;
    },
    maxBusy,
    list: () => [mainInfo, ...[...workers.values()].map((w) => w.info)].map((w) => ({ ...w })),
    busyCount,
    focus(id) {
      const w = info(id);
      focusId = id;
      w.needsAttention = false;
    },
    async parallel({ name, cwd }) {
      assertRoom();
      let wtName: string | undefined;
      let dir = cwd;
      if (!dir) {
        wtName = name ?? `w${Date.now().toString(36)}${counter}`;
        dir = addWorktree(mainCwd, wtName).path;
      }
      const id = `w${++counter}-${randomBytes(3).toString("hex")}`;
      try {
        const entry = await start(id, dir);
        if (wtName) {
          const parent = path.resolve(mainCwd);
          entry.info.worktree = { name: wtName, parent };
          try {
            addWorkspace(opts.homeDir, dir, { kind: "worktree", parent });
          } catch (err) {
            console.error(`[tah] could not save worktree workspace: ${err instanceof Error ? err.message : err}`);
          }
        }
        entry.info.cwd = dir;
        return { ...entry.info };
      } catch (err) {
        if (wtName) removeWorktree(mainCwd, wtName);
        throw err;
      }
    },
    async stop(id) {
      const entry = entryOf(id);
      halt(entry);
      entry.info.dead = true;
      entry.info.busy = false;
    },
    async restart(id) {
      const entry = entryOf(id);
      halt(entry);
      entry.info.busy = false;
      await start(id, entry.info.cwd);
      delete entry.info.dead;
    },
    async remove(id) {
      const entry = entryOf(id);
      halt(entry);
      workers.delete(id);
      if (focusId === id) focusId = MAIN;
      const wt = entry.info.worktree;
      if (wt) removeWorktree(wt.parent, wt.name);
    },
    async send(id, text, attachmentIds = []) {
      if (id === MAIN) return startsTurn(id, () => mainHost.send(text, attachmentIds));
      entryOf(id);
      return startsTurn(id, () => post(id, "/send", { text, attachmentIds }));
    },
    async cancel(id) {
      if (id === MAIN) return mainHost.cancel();
      await post(id, "/cancel");
    },
    async answer(id, approvalId, answer) {
      if (id === MAIN) return mainHost.answer(approvalId, answer);
      await post(id, "/answer", { id: approvalId, answer });
    },
    async answerQuestion(id, questionId, answers) {
      if (id === MAIN) return mainHost.answerQuestion(questionId, answers);
      await post(id, "/question", { id: questionId, answers });
    },
    async skipQuestion(id, questionId) {
      if (id === MAIN) return mainHost.skipQuestion(questionId);
      await post(id, "/question", { id: questionId, skip: true });
    },
    async continueTurn(id) {
      if (id === MAIN) return startsTurn(id, () => mainHost.continueTurn());
      entryOf(id);
      return startsTurn(id, () => post(id, "/continue"));
    },
    async compact(id) {
      if (id === MAIN) return startsTurn(id, () => mainHost.compact());
      entryOf(id);
      return startsTurn(id, () => post(id, "/compact"));
    },
    async queue(id, op) {
      if (id === MAIN) {
        if (op.remove) return mainHost.removeQueued(op.id);
        if (op.send) return startsTurn(id, () => mainHost.sendQueued(op.id));
        throw new Error('pass "send": true or "remove": true');
      }
      entryOf(id);
      if (op.send) return startsTurn(id, () => post(id, "/queue", { id: op.id, send: true }));
      await post(id, "/queue", { id: op.id, ...(op.remove ? { remove: true } : {}) });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fetchWorker(id, route, init) {
      const entry = entryOf(id);
      if (entry.info.dead) throw new Error(`worker is stopped: ${id}`);
      return fetch(`${entry.url}${route}`, {
        ...init,
        headers: { authorization: `Bearer ${entry.token}`, ...(init?.headers as Record<string, string> | undefined) },
      });
    },
    setMain(host, cwd) {
      mainOff();
      mainHost = host;
      mainCwd = cwd;
      mainOff = host.on((event) => handle(MAIN, event));
      const snap = host.snapshot();
      mainInfo.cwd = cwd;
      mainInfo.sessionId = snap.id;
      mainInfo.busy = false;
      mainInfo.needsAttention = false;
    },
    async dispose() {
      mainOff();
      for (const entry of workers.values()) halt(entry);
      workers.clear();
      listeners.clear();
    },
  };
}
