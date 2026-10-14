/** Stand-ins for the browser panel: a browser whose debugging port is 9222, and a CDP connection that records commands. */
export type Sent = { method: string; params: Record<string, unknown>; sessionId?: string };
type Listener = (method: string, params: Record<string, unknown>, sessionId: string | undefined) => void;

export function fakeBrowser(opts: { failLaunch?: string } = {}) {
  let running = false;
  let launches = 0;
  let closes = 0;
  const browser = {
    plugin: { name: "browser" },
    agentAttached: () => false,
    running: () => running,
    async launch() {
      launches += 1;
      if (opts.failLaunch) throw new Error(opts.failLaunch);
      running = true;
    },
    cdpPort: () => (running ? 9222 : undefined),
    async close() {
      closes += 1;
      running = false;
    },
  };
  return { browser, launches: () => launches, closes: () => closes, crash: () => void (running = false) };
}

/** Starts with one page tab `T1`; attaching to tab X gives session `S-X`. */
export function fakeCdp() {
  const sent: Sent[] = [];
  let listener: Listener = () => {};
  let closer = () => {};
  let closed = false;
  const cdp = {
    async send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
      sent.push(sessionId ? { method, params, sessionId } : { method, params });
      if (method === "Target.getTargets") {
        return { targetInfos: [{ targetId: "T1", type: "page", title: "Blank", url: "about:blank" }] };
      }
      if (method === "Target.attachToTarget") return { sessionId: `S-${String(params.targetId)}` };
      if (method === "Page.getNavigationHistory") return { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }] };
      return {};
    },
    on(l: Listener) {
      listener = l;
    },
    onClose(l: () => void) {
      closer = l;
    },
    close() {
      if (closed) return;
      closed = true;
      closer();
    },
  };
  return {
    cdp,
    sent,
    event: (method: string, params: Record<string, unknown>, sessionId?: string) => listener(method, params, sessionId),
    closed: () => closed,
  };
}

/** Lets pending promise chains settle. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));
