import type { Browser } from "../browser.js";
import type { BrowserDialog, BrowserInput, BrowserState, BrowserStreamEvent } from "./protocol.js";

type Params = Record<string, unknown>;
type Tab = BrowserState["tabs"][number];
type TargetInfo = { targetId: string; type: string; title: string; url: string };
type Frame = Extract<BrowserStreamEvent, { type: "frame" }>;

/** A Chrome DevTools Protocol connection to the whole browser; `sessionId` addresses an attached tab. */
export type Cdp = {
  send(method: string, params?: Params, sessionId?: string): Promise<Params>;
  on(listener: (method: string, params: Params, sessionId: string | undefined) => void): void;
  onClose(listener: () => void): void;
  close(): void;
};

/** Connects to the browser-level endpoint Chrome lists at `/json/version`. */
export async function connectCdp(port: number): Promise<Cdp> {
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error(`could not connect to the browser on port ${port}`)), { once: true });
  });
  let id = 0;
  const pending = new Map<number, { resolve(result: Params): void; reject(err: Error): void }>();
  const listeners: Array<(method: string, params: Params, sessionId: string | undefined) => void> = [];
  const closers: Array<() => void> = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: Params;
      result?: Params;
      error?: { message: string };
      sessionId?: string;
    };
    if (msg.id !== undefined) {
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) waiter?.reject(new Error(msg.error.message));
      else waiter?.resolve(msg.result ?? {});
    } else if (msg.method) {
      for (const listener of listeners) listener(msg.method, msg.params ?? {}, msg.sessionId);
    }
  });
  ws.addEventListener("close", () => {
    for (const waiter of pending.values()) waiter.reject(new Error("the browser connection closed"));
    pending.clear();
    for (const closer of closers) closer();
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) return reject(new Error("the browser connection closed"));
        id += 1;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    on: (listener) => void listeners.push(listener),
    onClose: (listener) => void closers.push(listener),
    close: () => ws.close(),
  };
}

const SELF = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** What the panel may open: web pages other than tah itself (`port`), a blank page, or one of this server's file previews. */
export function browserURL(input: string, port: number): string | undefined {
  const text = input.trim();
  if (text === "about:blank") return text;
  let url: URL;
  try {
    if (text.startsWith("/")) {
      url = new URL(text, `http://127.0.0.1:${port}`);
      return url.pathname.startsWith("/preview/") ? url.href : undefined;
    }
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const urlPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (SELF.has(url.hostname) && urlPort === port) return undefined;
  return url.href;
}

const num = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`"${name}" must be a number`);
  return value;
};
const int = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`"${name}" must be a non-negative integer`);
  return value;
};
const str = (value: unknown, name: string): string => {
  if (typeof value !== "string") throw new Error(`"${name}" must be a string`);
  return value;
};
const oneOf = <T extends string>(value: unknown, name: string, values: readonly T[]): T => {
  if (!values.includes(value as T)) throw new Error(`"${name}" must be one of ${values.join(", ")}`);
  return value as T;
};

/** Checks a `POST /api/browser/input` body; unknown fields are dropped. */
export function parseInput(body: Record<string, unknown>): BrowserInput {
  switch (body.type) {
    case "mouse":
      return {
        type: "mouse",
        event: oneOf(body.event, "event", ["move", "down", "up"] as const),
        x: num(body.x, "x"),
        y: num(body.y, "y"),
        button: oneOf(body.button, "button", ["left", "middle", "right", "none"] as const),
        clickCount: int(body.clickCount, "clickCount"),
        modifiers: int(body.modifiers, "modifiers"),
      };
    case "wheel":
      return {
        type: "wheel",
        x: num(body.x, "x"),
        y: num(body.y, "y"),
        dx: num(body.dx, "dx"),
        dy: num(body.dy, "dy"),
        modifiers: int(body.modifiers, "modifiers"),
      };
    case "key": {
      const key = {
        type: "key" as const,
        event: oneOf(body.event, "event", ["down", "up"] as const),
        key: str(body.key, "key"),
        code: str(body.code, "code"),
        keyCode: int(body.keyCode, "keyCode"),
        modifiers: int(body.modifiers, "modifiers"),
      };
      return body.text === undefined ? key : { ...key, text: str(body.text, "text") };
    }
    case "text":
      return { type: "text", text: str(body.text, "text") };
  }
  throw new Error('"type" must be one of mouse, wheel, key, text');
}

const MOUSE = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" } as const;

/** The CDP command for one input. */
export function cdpInput(input: BrowserInput): [string, Params] {
  switch (input.type) {
    case "mouse": {
      const { x, y, button, clickCount, modifiers } = input;
      return ["Input.dispatchMouseEvent", { type: MOUSE[input.event], x, y, button, clickCount, modifiers }];
    }
    case "wheel":
      return [
        "Input.dispatchMouseEvent",
        { type: "mouseWheel", x: input.x, y: input.y, deltaX: input.dx, deltaY: input.dy, modifiers: input.modifiers },
      ];
    case "key": {
      const params: Params = {
        type: input.event === "up" ? "keyUp" : input.text ? "keyDown" : "rawKeyDown",
        key: input.key,
        code: input.code,
        windowsVirtualKeyCode: input.keyCode,
        modifiers: input.modifiers,
      };
      if (input.text) params.text = input.text;
      // Chrome on macOS selects all only through the editing command, not the key press.
      if (input.event === "down" && input.key.toLowerCase() === "a" && input.modifiers & 6) params.commands = ["selectAll"];
      return ["Input.dispatchKeyEvent", params];
    }
    case "text":
      return ["Input.insertText", { text: input.text }];
  }
}

export type Screen = {
  state(): BrowserState;
  /** Sends `state` now and on every change, plus the shown tab's frames while subscribed. */
  subscribe(listener: (event: BrowserStreamEvent) => void): () => void;
  /** Drops the connection to a browser that stopped or was replaced; connects to a running one while someone watches. */
  sync(): Promise<void>;
  /** Starts the browser if needed; opens `url` (already checked with `browserURL`) in the shown tab. */
  open(url?: string): Promise<void>;
  nav(action: "back" | "reload"): Promise<void>;
  tab(id: string): Promise<void>;
  input(input: BrowserInput): Promise<void>;
  /** Answers the shown tab's JavaScript dialog. */
  dialog(accept: boolean, text?: string): Promise<void>;
  close(): Promise<void>;
  dispose(): void;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Chrome sends no event when a page changes its title, so titles are re-read this often while someone watches. */
const RETITLE_MS = 1000;

/** The browser panel's side of the open folder's browser. */
export function createScreen(opts: { browser(): Browser | undefined; connect?: (port: number) => Promise<Cdp> }): Screen {
  const listeners = new Set<(event: BrowserStreamEvent) => void>();
  const tabs = new Map<string, Tab>();
  let cdp: Cdp | undefined;
  let owner: Browser | undefined;
  let connecting: Promise<Cdp | undefined> | undefined;
  let active: string | null = null;
  let session: string | undefined;
  let showing: Promise<void> = Promise.resolve();
  let casting = false;
  let lastFrame: Frame | undefined;
  let error: string | undefined;
  let dialog: BrowserDialog | undefined;
  let retitling: NodeJS.Timeout | undefined;
  let disposed = false;

  const state = (): BrowserState => {
    const b = opts.browser();
    return {
      available: b !== undefined,
      running: b?.running() ?? false,
      agent: b?.agentAttached() ?? false,
      tabs: [...tabs.values()],
      active,
      ...(error === undefined ? {} : { error }),
      ...(dialog === undefined ? {} : { dialog }),
    };
  };
  const emit = (event: BrowserStreamEvent) => {
    for (const listener of listeners) listener(event);
  };
  const push = () => emit({ type: "state", state: state() });

  const forget = () => {
    tabs.clear();
    active = null;
    session = undefined;
    casting = false;
    lastFrame = undefined;
    dialog = undefined;
  };
  const drop = () => {
    const c = cdp;
    cdp = undefined;
    owner = undefined;
    forget();
    c?.close();
  };

  async function cast(on: boolean) {
    const c = cdp;
    const s = session;
    if (!c || !s || casting === on) return;
    casting = on;
    await c.send(on ? "Page.startScreencast" : "Page.stopScreencast", on ? { format: "jpeg", quality: 70 } : {}, s).catch(() => {});
  }

  async function retitle() {
    const c = cdp;
    if (!c) return;
    const { targetInfos } = (await c.send("Target.getTargets")) as { targetInfos: TargetInfo[] };
    if (c !== cdp) return;
    let changed = false;
    for (const t of targetInfos) {
      const tab = tabs.get(t.targetId);
      if (!tab || tab.title === t.title) continue;
      tabs.set(t.targetId, { ...tab, title: t.title });
      changed = true;
    }
    if (changed) push();
  }

  /** Shows tab `id`: attaches to it (detaching the previous one) and streams it while someone watches. */
  function show(id: string): Promise<void> {
    const c = cdp;
    if (!c) return Promise.resolve();
    const previous = session;
    active = id;
    session = undefined;
    casting = false;
    lastFrame = undefined;
    dialog = undefined;
    push();
    showing = (async () => {
      if (previous) await c.send("Target.detachFromTarget", { sessionId: previous }).catch(() => {});
      const { sessionId } = (await c.send("Target.attachToTarget", { targetId: id, flatten: true })) as { sessionId: string };
      if (active !== id || cdp !== c) {
        await c.send("Target.detachFromTarget", { sessionId }).catch(() => {});
        return;
      }
      session = sessionId;
      await c.send("Target.activateTarget", { targetId: id }).catch(() => {});
      await c.send("Page.enable", {}, sessionId).catch(() => {});
      if (listeners.size > 0) await cast(true);
    })().catch(() => {});
    return showing;
  }

  const onEvent = (c: Cdp) => (method: string, params: Params, sessionId: string | undefined) => {
    if (c !== cdp) return;
    if (method === "Page.screencastFrame") {
      if (sessionId === undefined || sessionId !== session) return;
      void c.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId).catch(() => {});
      const meta = params.metadata as { deviceWidth: number; deviceHeight: number };
      lastFrame = { type: "frame", data: params.data as string, width: meta.deviceWidth, height: meta.deviceHeight };
      emit(lastFrame);
      return;
    }
    if (method === "Page.javascriptDialogOpening" || method === "Page.javascriptDialogClosed") {
      if (sessionId === undefined || sessionId !== session) return;
      dialog = method === "Page.javascriptDialogOpening" ? { type: params.type as BrowserDialog["type"], message: params.message as string } : undefined;
      return push();
    }
    const info = params.targetInfo as TargetInfo | undefined;
    if (method === "Target.targetCreated" && info?.type === "page") {
      tabs.set(info.targetId, { id: info.targetId, title: info.title, url: info.url });
      void show(info.targetId);
    } else if (method === "Target.targetInfoChanged" && info && tabs.has(info.targetId)) {
      tabs.set(info.targetId, { id: info.targetId, title: info.title, url: info.url });
      push();
    } else if (method === "Target.targetDestroyed") {
      const id = params.targetId as string;
      if (!tabs.delete(id)) return;
      if (active !== id) return push();
      active = null;
      session = undefined;
      casting = false;
      lastFrame = undefined;
      dialog = undefined;
      const last = [...tabs.keys()].at(-1);
      if (last) void show(last);
      else push();
    }
  };

  function connect(): Promise<Cdp | undefined> {
    if (cdp) return Promise.resolve(cdp);
    connecting ??= (async () => {
      const b = opts.browser();
      const port = b?.cdpPort();
      if (!b || port === undefined) return undefined;
      const c = await (opts.connect ?? connectCdp)(port);
      if (disposed) {
        c.close();
        return undefined;
      }
      cdp = c;
      owner = b;
      c.on(onEvent(c));
      c.onClose(() => {
        if (cdp !== c) return;
        cdp = undefined;
        owner = undefined;
        forget();
        push();
      });
      await c.send("Target.setDiscoverTargets", { discover: true });
      const { targetInfos } = (await c.send("Target.getTargets")) as { targetInfos: TargetInfo[] };
      for (const t of targetInfos) {
        if (t.type === "page" && !tabs.has(t.targetId)) tabs.set(t.targetId, { id: t.targetId, title: t.title, url: t.url });
      }
      const last = [...tabs.keys()].at(-1);
      if (active === null && last) await show(last);
      else push();
      return c;
    })().finally(() => (connecting = undefined));
    return connecting;
  }

  /** The connection and the shown tab's session, once attached. */
  async function ready(): Promise<{ c: Cdp; s: string }> {
    const c = cdp ?? (opts.browser()?.running() ? await connect() : undefined);
    let shown: Promise<void>;
    do {
      shown = showing;
      await shown;
    } while (shown !== showing);
    if (!c || cdp !== c || !session) throw new Error("the browser is not open");
    return { c, s: session };
  }

  async function sync() {
    const b = opts.browser();
    if (cdp && (b !== owner || !b?.running())) drop();
    if (b?.running() && !cdp && listeners.size > 0) {
      try {
        await connect();
        error = undefined;
      } catch (err) {
        error = message(err);
      }
    }
    push();
  }

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      listener({ type: "state", state: state() });
      if (lastFrame) listener(lastFrame);
      if (listeners.size === 1) {
        void (cdp ? cast(true) : sync());
        retitling = setInterval(() => void retitle().catch(() => {}), RETITLE_MS).unref();
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        clearInterval(retitling);
        void cast(false);
      };
    },
    sync,
    async open(url) {
      const b = opts.browser();
      if (!b) throw new Error("the built-in browser is off in this folder");
      error = undefined;
      try {
        await b.launch();
        if (cdp && owner !== b) drop();
        if (!(await connect())) throw new Error("could not find the browser's debugging port");
      } catch (err) {
        error = message(err);
        push();
        throw err;
      }
      if (url) {
        const { c, s } = await ready();
        await c.send("Page.navigate", { url }, s);
      }
      push();
    },
    async nav(action) {
      const { c, s } = await ready();
      if (action === "reload") {
        await c.send("Page.reload", {}, s);
        return;
      }
      const history = (await c.send("Page.getNavigationHistory", {}, s)) as { currentIndex: number; entries: { id: number }[] };
      const entry = history.entries[history.currentIndex - 1];
      if (entry) await c.send("Page.navigateToHistoryEntry", { entryId: entry.id }, s);
    },
    async tab(id) {
      if (!tabs.has(id)) throw new Error(`no tab "${id}"`);
      await show(id);
    },
    async input(input) {
      const { c, s } = await ready();
      const [method, params] = cdpInput(input);
      await c.send(method, params, s);
    },
    async dialog(accept, text) {
      const { c, s } = await ready();
      await c.send("Page.handleJavaScriptDialog", { accept, ...(text === undefined ? {} : { promptText: text }) }, s);
    },
    async close() {
      const b = opts.browser();
      drop();
      error = undefined;
      await b?.close();
      push();
    },
    dispose() {
      disposed = true;
      listeners.clear();
      clearInterval(retitling);
      drop();
    },
  };
}
