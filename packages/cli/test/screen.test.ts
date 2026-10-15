import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { test } from "node:test";
import { browserURL, cdpInput, connectCdp, createScreen, parseInput } from "../dist/serve/screen.js";
import { fakeBrowser, fakeCdp, tick, within } from "./fixtures/fake-cdp.ts";

test("browserURL: web pages, a blank page and file previews; never tah itself", () => {
  assert.equal(browserURL("https://example.com/a", 7000), "https://example.com/a");
  assert.equal(browserURL(" http://localhost:3000/ ", 7000), "http://localhost:3000/");
  assert.equal(browserURL("about:blank", 7000), "about:blank");
  assert.equal(browserURL("/preview/tok/a%20b.html", 7000), "http://127.0.0.1:7000/preview/tok/a%20b.html");
  for (const bad of [
    "http://127.0.0.1:7000/",
    "http://localhost:7000/api/events",
    "http://[::1]:7000/",
    "http://2130706433:7000/",
    "/api/events",
    "/preview/../api/events",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "chrome://settings",
    "example.com",
    "",
    "//[",
    "/[",
  ]) {
    assert.equal(browserURL(bad, 7000), undefined, bad);
  }
  assert.equal(browserURL("http://127.0.0.1/", 80), undefined);
});

test("parseInput keeps valid input and rejects anything else", () => {
  const mouse = { type: "mouse", event: "down", x: 1, y: 2.5, button: "left", clickCount: 1, modifiers: 0 };
  const wheel = { type: "wheel", x: 1, y: 2, dx: 0, dy: 120, modifiers: 8 };
  const key = { type: "key", event: "down", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0, text: "\r" };
  assert.deepEqual(parseInput(mouse), mouse);
  assert.deepEqual(parseInput({ ...mouse, extra: 1 }), mouse);
  assert.deepEqual(parseInput(wheel), wheel);
  assert.deepEqual(parseInput(key), key);
  const { text: _text, ...plainKey } = key;
  assert.deepEqual(parseInput(plainKey), plainKey);
  assert.deepEqual(parseInput({ type: "text", text: "你好" }), { type: "text", text: "你好" });
  for (const bad of [
    { type: "mouse" },
    { ...mouse, event: "click" },
    { ...mouse, x: "1" },
    { ...mouse, button: "back" },
    { ...wheel, dy: Infinity },
    { ...mouse, clickCount: 1.5 },
    { ...mouse, modifiers: -1 },
    { ...wheel, modifiers: 0.5 },
    { ...key, keyCode: 13.5 },
    { ...key, keyCode: -13 },
    { ...key, text: 1 },
    { type: "text" },
    { type: "touch" },
    {},
  ]) {
    assert.throws(() => parseInput(bad), Error, JSON.stringify(bad));
  }
});

test("cdpInput maps input to CDP commands", () => {
  assert.deepEqual(cdpInput({ type: "mouse", event: "down", x: 1, y: 2, button: "left", clickCount: 2, modifiers: 8 }), [
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: 1, y: 2, button: "left", clickCount: 2, modifiers: 8 },
  ]);
  assert.equal(cdpInput({ type: "mouse", event: "move", x: 1, y: 2, button: "none", clickCount: 0, modifiers: 0 })[1].type, "mouseMoved");
  assert.equal(cdpInput({ type: "mouse", event: "up", x: 1, y: 2, button: "left", clickCount: 1, modifiers: 0 })[1].type, "mouseReleased");
  assert.deepEqual(cdpInput({ type: "wheel", x: 1, y: 2, dx: 0, dy: 100, modifiers: 0 }), [
    "Input.dispatchMouseEvent",
    { type: "mouseWheel", x: 1, y: 2, deltaX: 0, deltaY: 100, modifiers: 0 },
  ]);
  assert.deepEqual(cdpInput({ type: "key", event: "down", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0, text: "\r" }), [
    "Input.dispatchKeyEvent",
    { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0, text: "\r" },
  ]);
  assert.equal(cdpInput({ type: "key", event: "down", key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, modifiers: 0 })[1].type, "rawKeyDown");
  assert.equal(cdpInput({ type: "key", event: "up", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0 })[1].type, "keyUp");
  assert.deepEqual(cdpInput({ type: "key", event: "down", key: "a", code: "KeyA", keyCode: 65, modifiers: 4 })[1].commands, ["selectAll"]);
  assert.deepEqual(cdpInput({ type: "text", text: "你好" }), ["Input.insertText", { text: "你好" }]);
});

test("open launches the browser, attaches to its newest tab and navigates it", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const ports: number[] = [];
  const screen = createScreen({
    browser: () => fb.browser,
    connect: async (port) => {
      ports.push(port);
      return fc.cdp;
    },
  });
  assert.deepEqual(screen.state(), { available: true, running: false, agent: false, tabs: [], active: null });
  await screen.open("https://example.com/");
  assert.equal(fb.launches(), 1);
  assert.deepEqual(ports, [9222]);
  assert.deepEqual(fc.sent.map((m) => m.method), [
    "Target.setDiscoverTargets",
    "Target.getTargets",
    "Target.attachToTarget",
    "Target.activateTarget",
    "Page.enable",
    "Page.navigate",
  ]);
  assert.deepEqual(fc.sent.at(-1), { method: "Page.navigate", params: { url: "https://example.com/" }, sessionId: "S-T1" });
  assert.deepEqual(screen.state(), {
    available: true,
    running: true,
    agent: false,
    tabs: [{ id: "T1", title: "Blank", url: "about:blank" }],
    active: "T1",
  });
  await screen.open();
  assert.deepEqual(ports, [9222]);
  screen.dispose();
});

test("frames: screencast only while someone watches; a late watcher gets the last frame", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  assert.equal(fc.sent.some((m) => m.method === "Page.startScreencast"), false);
  const a: Array<{ type: string; data?: string }> = [];
  const offA = screen.subscribe((e) => a.push(e));
  await tick();
  assert.equal(a[0]?.type, "state");
  assert.deepEqual(fc.sent.at(-1), { method: "Page.startScreencast", params: { format: "jpeg", quality: 70 }, sessionId: "S-T1" });
  fc.event("Page.screencastFrame", { data: "AAAA", sessionId: 7, metadata: { deviceWidth: 1280, deviceHeight: 720 } }, "S-T1");
  fc.event("Page.screencastFrame", { data: "ZZZZ", sessionId: 8, metadata: { deviceWidth: 1280, deviceHeight: 720 } }, "S-OTHER");
  await tick();
  assert.deepEqual(a.at(-1), { type: "frame", data: "AAAA", width: 1280, height: 720 });
  assert.ok(fc.sent.some((m) => m.method === "Page.screencastFrameAck" && m.params.sessionId === 7 && m.sessionId === "S-T1"));
  const b: Array<{ type: string; data?: string }> = [];
  const offB = screen.subscribe((e) => b.push(e));
  assert.deepEqual(b.map((e) => e.type), ["state", "frame"]);
  assert.equal(b[1]?.data, "AAAA");
  offA();
  offB();
  await tick();
  assert.deepEqual(fc.sent.at(-1), { method: "Page.stopScreencast", params: {}, sessionId: "S-T1" });
  screen.dispose();
});

test("tab titles are re-read while someone watches, since Chrome does not report title changes", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  const off = screen.subscribe(() => {});
  await tick();
  fc.targets[0]!.title = "Docs";
  t.mock.timers.tick(1000);
  await tick();
  assert.equal(screen.state().tabs[0]?.title, "Docs");
  off();
  fc.targets[0]!.title = "Later";
  const reads = fc.sent.filter((m) => m.method === "Target.getTargets").length;
  t.mock.timers.tick(5000);
  await tick();
  assert.equal(fc.sent.filter((m) => m.method === "Target.getTargets").length, reads);
  screen.dispose();
});

test("a new tab takes over the panel; closing it goes back to the remaining one", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  fc.event("Target.targetCreated", { targetInfo: { targetId: "T2", type: "page", title: "Login", url: "https://id.example/" } });
  fc.event("Target.targetCreated", { targetInfo: { targetId: "W1", type: "service_worker", title: "", url: "" } });
  await tick();
  assert.equal(screen.state().active, "T2");
  assert.ok(fc.sent.some((m) => m.method === "Target.detachFromTarget" && m.params.sessionId === "S-T1"));
  fc.event("Target.targetInfoChanged", { targetInfo: { targetId: "T2", type: "page", title: "Signed in", url: "https://id.example/done" } });
  assert.deepEqual(screen.state().tabs.map((t) => t.title), ["Blank", "Signed in"]);
  await screen.input({ type: "text", text: "x" });
  assert.equal(fc.sent.at(-1)?.sessionId, "S-T2");
  fc.event("Target.targetDestroyed", { targetId: "T2" });
  await tick();
  assert.equal(screen.state().active, "T1");
  await assert.rejects(screen.tab("T2"), /no tab "T2"/);
  await screen.tab("T1");
  screen.dispose();
});

test("a lost connection is reported; sync reconnects while someone watches", async () => {
  const fb = fakeBrowser();
  const conns = [fakeCdp(), fakeCdp()];
  let n = 0;
  const screen = createScreen({ browser: () => fb.browser, connect: async () => conns[n++]!.cdp });
  await screen.open();
  const events: Array<{ type: string }> = [];
  screen.subscribe((e) => events.push(e));
  const before = events.length;
  conns[0]!.cdp.close();
  assert.deepEqual(screen.state(), { available: true, running: true, agent: false, tabs: [], active: null });
  assert.ok(events.length > before);
  await screen.sync();
  assert.equal(n, 2);
  assert.equal(screen.state().active, "T1");
  screen.dispose();
});

test("sync drops the connection when the browser stops or the folder's browser changes", async () => {
  const first = fakeBrowser();
  let current = first.browser;
  const conns = [fakeCdp(), fakeCdp()];
  let n = 0;
  const screen = createScreen({ browser: () => current, connect: async () => conns[n++]!.cdp });
  await screen.open();
  first.crash();
  await screen.sync();
  assert.equal(conns[0]!.closed(), true);
  assert.deepEqual(screen.state(), { available: true, running: false, agent: false, tabs: [], active: null });
  await screen.open();
  current = fakeBrowser().browser;
  await screen.sync();
  assert.equal(conns[1]!.closed(), true);
  screen.dispose();
});

test("open reports a browser that cannot start; a folder without the browser says so", async () => {
  const fb = fakeBrowser({ failLaunch: "could not start the browser: no Chrome" });
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fakeCdp().cdp });
  await assert.rejects(screen.open(), /no Chrome/);
  assert.equal(screen.state().error, "could not start the browser: no Chrome");

  const off = createScreen({ browser: () => undefined });
  assert.deepEqual(off.state(), { available: false, running: false, agent: false, tabs: [], active: null });
  await assert.rejects(off.open(), /the built-in browser is off in this folder/);
  await assert.rejects(off.input({ type: "text", text: "x" }), /the browser is not open/);
});

test("input, back, reload and close go to the shown tab", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  await screen.input({ type: "text", text: "你好" });
  assert.deepEqual(fc.sent.at(-1), { method: "Input.insertText", params: { text: "你好" }, sessionId: "S-T1" });
  await screen.nav("back");
  assert.deepEqual(fc.sent.at(-1), { method: "Page.navigateToHistoryEntry", params: { entryId: 10 }, sessionId: "S-T1" });
  await screen.nav("reload");
  assert.deepEqual(fc.sent.at(-1), { method: "Page.reload", params: {}, sessionId: "S-T1" });
  await screen.close();
  assert.equal(fb.closes(), 1);
  assert.equal(fc.closed(), true);
  assert.equal(screen.state().running, false);
});

test("a dialog in the shown tab is reported until it is answered", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  fc.event("Page.javascriptDialogOpening", { type: "alert", message: "elsewhere" }, "S-OTHER");
  assert.equal(screen.state().dialog, undefined);
  fc.event("Page.javascriptDialogOpening", { type: "prompt", message: "Name?" }, "S-T1");
  assert.deepEqual(screen.state().dialog, { type: "prompt", message: "Name?" });
  await screen.dialog(true, "Ann");
  assert.deepEqual(fc.sent.at(-1), { method: "Page.handleJavaScriptDialog", params: { accept: true, promptText: "Ann" }, sessionId: "S-T1" });
  fc.event("Page.javascriptDialogClosed", { result: true }, "S-T1");
  assert.equal(screen.state().dialog, undefined);
  await screen.dialog(false);
  assert.deepEqual(fc.sent.at(-1), { method: "Page.handleJavaScriptDialog", params: { accept: false }, sessionId: "S-T1" });
});

test("connectCdp: a command sent after the connection closed fails at once", async () => {
  const sockets: Socket[] = [];
  const server = createServer((_req, res) => {
    const { port } = server.address() as AddressInfo;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }));
  });
  server.on("upgrade", (req, socket: Socket) => {
    const accept = createHash("sha1")
      .update(`${String(req.headers["sec-websocket-key"])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.push(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const cdp = await connectCdp((server.address() as AddressInfo).port);
    const closed = new Promise<void>((resolve) => cdp.onClose(resolve));
    sockets[0]!.destroy();
    await within(closed);
    await within(assert.rejects(cdp.send("Target.getTargets"), /the browser connection closed/));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("connectCdp gives up on a port that never answers, or answers without a debugger address", async () => {
  const sockets: Socket[] = [];
  let answer: string | undefined;
  const server = createServer((_req, res) => {
    if (answer !== undefined) res.end(answer);
  });
  server.on("upgrade", (_req, socket: Socket) => void sockets.push(socket));
  server.on("connection", (socket) => void sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await within(assert.rejects(connectCdp(port, 100), /could not connect to the browser/));
    answer = "{}";
    await within(assert.rejects(connectCdp(port, 100), /could not connect to the browser/));
    answer = JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` });
    await within(assert.rejects(connectCdp(port, 100), /could not connect to the browser/));
  } finally {
    for (const s of sockets) s.destroy();
    server.close();
  }
});

test("a tab that cannot be shown is reported; showing another one clears it", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp({ failAttach: "T2" });
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  fc.event("Target.targetCreated", { targetInfo: { targetId: "T2", type: "page", title: "", url: "about:blank" } });
  await tick();
  assert.match(screen.state().error ?? "", /could not show the tab: No target/);
  await screen.tab("T1");
  assert.equal(screen.state().error, undefined);
  screen.dispose();
});

test("a connection that closes while a tab is being shown does not leave open hanging", async () => {
  const fb = fakeBrowser();
  const conns = [fakeCdp(), fakeCdp()];
  const first = conns[0]!.cdp;
  const send = first.send.bind(first);
  first.send = async (method, params, sessionId) => {
    const out = await send(method, params, sessionId);
    if (method === "Target.attachToTarget") first.close();
    return out;
  };
  let n = 0;
  const screen = createScreen({ browser: () => fb.browser, connect: async () => conns[n++]!.cdp });
  await within(screen.open());
  assert.equal(screen.state().active, null);
  await within(screen.open("https://example.com/"));
  assert.equal(n, 2);
  assert.deepEqual(conns[1]!.sent.at(-1), { method: "Page.navigate", params: { url: "https://example.com/" }, sessionId: "S-T1" });
  screen.dispose();
});

test("input waits for a tab that takes over while an earlier one is still being shown", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const send = fc.cdp.send.bind(fc.cdp);
  fc.cdp.send = async (method, params, sessionId) => {
    if (method === "Target.attachToTarget" && params?.targetId === "T3") await tick();
    return send(method, params, sessionId);
  };
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  fc.event("Target.targetCreated", { targetInfo: { targetId: "T2", type: "page", title: "", url: "about:blank" } });
  const typing = screen.input({ type: "text", text: "x" });
  fc.event("Target.targetCreated", { targetInfo: { targetId: "T3", type: "page", title: "", url: "about:blank" } });
  await within(typing);
  assert.equal(screen.state().active, "T3");
  assert.deepEqual(fc.sent.at(-1), { method: "Input.insertText", params: { text: "x" }, sessionId: "S-T3" });
  screen.dispose();
});

test("dispose while connecting closes the new connection", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  let resolve: (cdp: typeof fc.cdp) => void = () => {};
  const screen = createScreen({ browser: () => fb.browser, connect: () => new Promise((r) => (resolve = r)) });
  const opening = screen.open();
  await tick();
  screen.dispose();
  resolve(fc.cdp);
  await within(assert.rejects(opening));
  assert.equal(fc.closed(), true);
  assert.deepEqual(fc.sent, []);
});
