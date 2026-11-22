import type { Plugin } from "@typescript-agent-harness/core";
import type { Browser } from "../browser.js";

type WorkerBrowserState = {
  available: boolean;
  running: boolean;
  agent: boolean;
  cdpPort?: number;
};

type WorkerClient = {
  getState(): Promise<WorkerBrowserState>;
  launch(): Promise<void>;
  close(): Promise<void>;
};

/** Parent-side Browser view of a remote worker's Chrome (CDP is on the worker's localhost). */
export function createWorkerBrowser(client: WorkerClient): Browser {
  let running = false;
  let agent = false;
  let cdpPort: number | undefined;
  let refresh: Promise<void> | undefined;

  const sync = async () => {
    const s = await client.getState();
    running = s.running;
    agent = s.agent;
    cdpPort = s.cdpPort;
  };

  const refreshState = (): Promise<void> =>
    refresh ?? (refresh = sync().finally(() => (refresh = undefined)));

  return {
    plugin: { name: "worker-browser", setup() {}, async dispose() {} } satisfies Plugin,
    agentAttached: () => agent,
    running: () => running,
    async launch() {
      await client.launch();
      await refreshState();
    },
    cdpPort: () => cdpPort,
    async close() {
      await client.close();
      running = false;
      agent = false;
      cdpPort = undefined;
    },
    syncState: refreshState,
  };
}

export function workerBrowserClient(
  fetchAuthed: (route: string, init?: RequestInit) => Promise<Response>,
): WorkerClient {
  const getState = async (): Promise<WorkerBrowserState> => {
    const res = await fetchAuthed("/browser");
    if (!res.ok) throw new Error(`worker /browser failed: ${res.status}`);
    return (await res.json()) as WorkerBrowserState;
  };
  return {
    getState,
    async launch() {
      const res = await fetchAuthed("/browser/launch", { method: "POST" });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `worker /browser/launch failed: ${res.status}`);
      }
    },
    async close() {
      const res = await fetchAuthed("/browser/close", { method: "POST" });
      if (!res.ok) throw new Error(`worker /browser/close failed: ${res.status}`);
    },
  };
}