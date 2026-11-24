import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { clearUnread, loadUnread, markUnread } from "../src/unread.ts";

type Store = Map<string, string>;

function mockLocalStorage(): Store {
  const data: Store = new Map();
  const ls = {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  return data;
}

const origin = "http://test.local";

beforeEach(() => mockLocalStorage());
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("loadUnread starts empty", () => {
  assert.deepEqual(loadUnread(origin), {});
});

test("mark/clear/load round-trip", () => {
  markUnread(origin, "w1");
  markUnread(origin, "w2");
  assert.deepEqual(loadUnread(origin), { w1: true, w2: true });
  clearUnread(origin, "w1");
  assert.deepEqual(loadUnread(origin), { w2: true });
  clearUnread(origin, "w2");
  assert.deepEqual(loadUnread(origin), {});
});

test("unread is scoped by origin", () => {
  markUnread("http://a", "w1");
  markUnread("http://b", "w2");
  assert.deepEqual(loadUnread("http://a"), { w1: true });
  assert.deepEqual(loadUnread("http://b"), { w2: true });
});

test("clearUnread is a no-op when id was not unread", () => {
  markUnread(origin, "w1");
  clearUnread(origin, "missing");
  assert.deepEqual(loadUnread(origin), { w1: true });
});