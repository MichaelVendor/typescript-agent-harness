import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addressURL,
  agentBrowsing,
  keyInput,
  modifiers,
  mouseButton,
  opensBrowser,
  opensInPanel,
  toPage,
} from "../src/browser-view.ts";

const none = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
const ORIGIN = "http://127.0.0.1:7433";

test("plain clicks on web links open in the panel; modified clicks and tah's own links do not", () => {
  const click = { ...none, button: 0 };
  assert.equal(opensInPanel("https://example.com/a", click, ORIGIN), true);
  assert.equal(opensInPanel("http://localhost:3000/", click, ORIGIN), true);
  for (const href of ["http://127.0.0.1:7433/x", "http://localhost:7433/", "mailto:a@b.c", "ftp://x/", "not a url", undefined]) {
    assert.equal(opensInPanel(href, click, ORIGIN), false, String(href));
  }
  for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    assert.equal(opensInPanel("https://example.com", { ...click, [mod]: true }, ORIGIN), false, mod);
  }
  assert.equal(opensInPanel("https://example.com", { ...click, button: 1 }, ORIGIN), false);
});

test("address bar: bare hosts get a scheme, the rest goes as typed", () => {
  assert.equal(addressURL(" example.com "), "https://example.com");
  assert.equal(addressURL("localhost:3000/a"), "http://localhost:3000/a");
  assert.equal(addressURL("127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(addressURL("https://x.dev/?q=1"), "https://x.dev/?q=1");
  assert.equal(addressURL("about:blank"), "about:blank");
  assert.equal(addressURL("/preview/t/a.html"), "/preview/t/a.html");
  assert.equal(addressURL("   "), "");
});

test("points on the scaled frame map to page pixels", () => {
  assert.deepEqual(toPage(110, 70, { left: 10, top: 20, width: 640, height: 360 }, { width: 1280, height: 720 }), { x: 200, y: 100 });
});

test("modifier bits and mouse buttons follow CDP", () => {
  assert.equal(modifiers(none), 0);
  assert.equal(modifiers({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true }), 15);
  assert.equal(modifiers({ ...none, metaKey: true }), 4);
  assert.deepEqual([0, 1, 2].map(mouseButton), ["left", "middle", "right"]);
  assert.deepEqual([3, 4].map(mouseButton), [undefined, undefined]);
});

test("keys: special keys and shortcuts are sent; typed characters, IME and clipboard shortcuts are not", () => {
  const key = (k: string, code: string, keyCode: number, extra: Partial<typeof none & { isComposing: boolean }> = {}) => ({
    ...none,
    key: k,
    code,
    keyCode,
    isComposing: false,
    ...extra,
  });
  assert.deepEqual(keyInput(key("Enter", "Enter", 13), "down"), {
    type: "key",
    event: "down",
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    modifiers: 0,
    text: "\r",
  });
  assert.deepEqual(keyInput(key("Enter", "Enter", 13), "up"), { type: "key", event: "up", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0 });
  assert.deepEqual(keyInput(key("Backspace", "Backspace", 8), "down"), {
    type: "key",
    event: "down",
    key: "Backspace",
    code: "Backspace",
    keyCode: 8,
    modifiers: 0,
  });
  assert.deepEqual(keyInput(key("a", "KeyA", 65, { metaKey: true }), "down"), {
    type: "key",
    event: "down",
    key: "a",
    code: "KeyA",
    keyCode: 65,
    modifiers: 4,
  });
  assert.equal(keyInput(key("a", "KeyA", 65), "down"), null);
  assert.equal(keyInput(key("A", "KeyA", 65, { shiftKey: true }), "down"), null);
  assert.equal(keyInput(key("Enter", "Enter", 13, { isComposing: true }), "down"), null);
  assert.equal(keyInput(key("Process", "KeyN", 229), "down"), null);
  assert.equal(keyInput(key("Enter", "Enter", 229), "down"), null);
  for (const k of ["c", "v", "x"]) {
    assert.equal(keyInput(key(k, `Key${k.toUpperCase()}`, 0, { metaKey: true }), "down"), null, k);
  }
  for (const [k, code] of [["с", "KeyC"], ["м", "KeyV"], ["ч", "KeyX"]]) {
    assert.equal(keyInput(key(k!, code!, 0, { ctrlKey: true }), "down"), null, code);
  }
  // Dvorak: ⌘V is the key that types "v" (physical Period); physical KeyV types "k".
  assert.equal(keyInput(key("v", "Period", 0, { metaKey: true }), "down"), null);
  assert.equal(keyInput(key("k", "KeyV", 75, { metaKey: true }), "down")?.type, "key");
});

test("the agent is browsing while a browser tool runs; browser_open opens the panel", () => {
  const tool = (name: string, status: "running" | "ok" | "failed") =>
    ({ id: 1, kind: "tool", callId: "c", tool: name, summary: "", status, result: "" }) as const;
  assert.equal(agentBrowsing([tool("browser_click", "running")]), true);
  assert.equal(agentBrowsing([tool("browser_click", "ok"), tool("read_file", "running")]), false);
  assert.equal(opensBrowser({ type: "tool.start", callId: "c", tool: "browser_open", summary: "" }), true);
  assert.equal(opensBrowser({ type: "tool.start", callId: "c", tool: "browser_click", summary: "" }), false);
  assert.equal(opensBrowser({ type: "tool.end", callId: "c", tool: "browser_open", summary: "", ok: true, result: "" }), false);
});
