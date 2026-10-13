import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionRow, WorkspaceView } from "@typescript-agent-harness/cli";
import { flatSessions, searchSessions, shownSessions, splitMatch } from "../src/sidebar-view.ts";

const s = (id: string, updatedAt: number, extra: Partial<SessionRow> = {}): SessionRow => ({
  id,
  state: "idle",
  turns: 1,
  updatedAt,
  preview: `preview ${id}`,
  ...extra,
});
const ws = (name: string, sessions: SessionRow[]): WorkspaceView => ({ path: `/${name}`, name, active: false, sessions });

test("search matches titles and folder names, case-insensitive, newest first, skipping archived", () => {
  const all = [
    ws("AgentHarness", [s("a", 1, { title: "Browser card" }), s("b", 5, { title: "Other" })]),
    ws("blog", [s("c", 3, { title: "browse dirs" }), s("d", 9, { title: "gone browser", archived: true })]),
  ];
  assert.deepEqual(searchSessions(all, "  BROW ").map((i) => i.session.id), ["c", "a"]);
  assert.deepEqual(searchSessions(all, "agentharness").map((i) => i.session.id), ["b", "a"]);
  assert.deepEqual(searchSessions(all, "   "), []);
});

test("search falls back to the preview when a session has no title", () => {
  const all = [ws("w", [s("a", 1, { preview: "fix the login page" })])];
  assert.deepEqual(searchSessions(all, "login").map((i) => i.session.id), ["a"]);
});

test("splitMatch marks every case-insensitive hit", () => {
  assert.deepEqual(splitMatch("Browser and brow", "brow"), [
    { text: "Brow", hit: true },
    { text: "ser and ", hit: false },
    { text: "brow", hit: true },
  ]);
  assert.deepEqual(splitMatch("plain", ""), [{ text: "plain", hit: false }]);
});

test("a folder shows its first sessions, and keeps the current one visible when it is further down", () => {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => s(`s${n}`, 10 - n));
  const short = shownSessions(rows, { limit: 5, expanded: false, current: "s2" });
  assert.deepEqual(short.rows.map((r) => r.id), ["s1", "s2", "s3", "s4", "s5"]);
  assert.equal(short.hidden, 3);

  const withCurrent = shownSessions(rows, { limit: 5, expanded: false, current: "s7" });
  assert.deepEqual(withCurrent.rows.map((r) => r.id), ["s1", "s2", "s3", "s4", "s5", "s7"]);
  assert.equal(withCurrent.hidden, 2);

  assert.deepEqual(shownSessions(rows, { limit: 5, expanded: true, current: "" }), { rows, hidden: 0 });
  assert.deepEqual(shownSessions(rows.slice(0, 5), { limit: 5, expanded: false, current: "" }).hidden, 0);
});

test("one list puts every folder's unpinned sessions together, newest first", () => {
  const all = [
    ws("a", [s("a1", 4), s("a2", 1, { pinned: true }), s("a3", 2, { archived: true })]),
    ws("b", [s("b1", 6), s("b2", 3)]),
  ];
  assert.deepEqual(flatSessions(all).map((i) => `${i.ws.name}/${i.session.id}`), ["b/b1", "a/a1", "b/b2"]);
});
