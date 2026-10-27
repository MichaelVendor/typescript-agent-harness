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

/** Starts with one page tab `T1`; attaching to tab X gives session `S-X`, except `failAttach`. */
export function fakeCdp(opts: { failAttach?: string } = {}) {
  const sent: Sent[] = [];
  const targets = [{ targetId: "T1", type: "page", title: "Blank", url: "about:blank" }];
  let listener: Listener = () => {};
  let closer = () => {};
  let closed = false;
  const cdp = {
    async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
      if (closed) throw new Error("the browser connection closed");
      sent.push(sessionId ? { method, params, sessionId } : { method, params });
      if (method === "Target.getTargets") return { targetInfos: targets.map((t) => ({ ...t })) };
      if (method === "Target.attachToTarget" && params.targetId === opts.failAttach) throw new Error("No target with given id found");
      if (method === "Target.attachToTarget") return { sessionId: `S-${String(params.targetId)}` };
      if (method === "Browser.getWindowForTarget") return { windowId: 1, bounds: { windowState: "normal", left: 0, top: 0, width: 1280, height: 720 } };
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
    /** What `Target.getTargets` reports; change a title here to play a page renaming itself. */
    targets,
    event: (method: string, params: Record<string, unknown>, sessionId?: string) => listener(method, params, sessionId),
    closed: () => closed,
  };
}

/** Lets pending promise chains settle. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Fails instead of hanging when `promise` does not settle within `ms`. */
export async function within<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
