import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ChatHost, HostEvent, SessionEvent } from "../dist/host.js";
import { listDirs, makeDir } from "../dist/serve/fs.js";
import { createHub } from "../dist/serve/hub.js";
import { createWorkspaces } from "../dist/serve/workspaces.js";
import { loadWorkspaces } from "../dist/workspaces.js";

const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

test("listDirs: folders only, hidden skipped, sorted; makeDir validates names", () => {
  const root = tmp("tah-fs-");
  mkdirSync(path.join(root, "b"));
  mkdirSync(path.join(root, "a"));
  mkdirSync(path.join(root, ".git"));
  writeFileSync(path.join(root, "file.txt"), "x");
  const listing = listDirs(root, "/unused");
  assert.equal(listing.path, root);
  assert.equal(listing.parent, path.dirname(root));
  assert.deepEqual(listing.dirs, ["a", "b"]);
  assert.equal(listDirs(undefined, root).path, root);
  assert.equal(listDirs("/", root).parent, null);
  assert.throws(() => listDirs(path.join(root, "file.txt"), root), /not a readable folder/);
  assert.throws(() => listDirs(path.join(root, "nope"), root), /not a readable folder/);

  assert.equal(makeDir(root, "c"), path.join(root, "c"));
  for (const bad of ["", ".", "..", "x/y", "x\\y", "a"]) assert.throws(() => makeDir(root, bad));
});

/**
 * Fake hosts: `open()` emits a notice and a session; `close()` is recorded.
 * `gate(cwd)` is awaited first inside `open()`; `failClose` makes that folder's `close()` reject.
 */
function hostFactory(opts: { gate?: (cwd: string) => Promise<void> | undefined; failClose?: string } = {}) {
  const closed: string[] = [];
  const make = async (cwd: string): Promise<ChatHost> => {
    if (cwd.endsWith("broken")) throw new Error("tah: tah.config.json: bad");
    const listeners = new Set<(e: HostEvent) => void>();
    const snap: SessionEvent = { type: "session", id: `s-${path.basename(cwd)}`, resumed: false, history: [], hiddenTurns: 0 };
    return {
      sessionId: snap.id,
      approve: true,
      on(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      async open() {
        await opts.gate?.(cwd);
        for (const l of listeners) l({ type: "notice", text: `boot ${cwd}` });
        for (const l of listeners) l(snap);
      },
      snapshot: () => snap,
      listSessions: async () => [{ id: snap.id, state: "idle", turns: 0, updatedAt: 1, preview: cwd }],
      renameSession: async () => "renamed-active",
      setSessionFlag: async () => {},
      async close() {
        closed.push(cwd);
        if (cwd === opts.failClose) throw new Error("close failed");
      },
    } as unknown as ChatHost;
  };
  return { make, closed };
}

test("activate swaps hosts; failure keeps the old folder; list covers every folder", async () => {
  const home = tmp("tah-ws-home-");
  const a = tmp("tah-ws-a-");
  const b = tmp("tah-ws-b-");
  const broken = path.join(tmp("tah-ws-"), "broken");
  mkdirSync(broken);
  const gone = path.join(tmp("tah-ws-"), "gone");
  const { make, closed } = hostFactory();
  const first = await make(a);
  const hub = createHub(first);
  await first.open();
  const ws = createWorkspaces({
    cwd: a,
    home,
    host: first,
    hub,
    createHost: make,
    readSessions: async (cwd) => {
      if (cwd === b) return [{ id: "old-b", state: "completed", turns: 1, updatedAt: 1, preview: "b" }];
      return [];
    },
  });
  assert.deepEqual(loadWorkspaces(home), [a]);

  assert.throws(() => ws.add(gone), /not a folder/);
  ws.add(b);
  ws.add(broken);
  assert.throws(() => ws.remove(a), /active/);

  const seen: HostEvent[] = [];
  hub.subscribe((e) => seen.push(e));
  seen.length = 0;

  await assert.rejects(ws.activate(path.join(home, "not-listed")), /not in the folder list/);
  await assert.rejects(ws.activate(broken), /tah.config.json/);
  assert.equal(ws.cwd, a);
  assert.equal(ws.host, first);

  assert.equal(await ws.activate(b), true);
  assert.equal(await ws.activate(b), false);
  assert.equal(ws.cwd, b);
  assert.deepEqual(closed, [a]);
  assert.deepEqual(seen.map((e) => e.type), ["session", "notice"]);

  const views = await ws.list();
  assert.deepEqual(
    views.map((v) => [v.path, v.active, v.sessions.map((s) => s.id)]),
    [
      [a, false, []],
      [b, true, [`s-${path.basename(b)}`]],
      [broken, false, []],
    ],
  );

  writeFileSync(path.join(home, ".tah", "workspaces.json"), JSON.stringify({ workspaces: [a, b, gone] }));
  const missing = (await ws.list()).find((v) => v.path === gone);
  assert.equal(missing?.missing, true);
});

test("rename / flag on a non-active folder write that folder's files", async () => {
  const home = tmp("tah-ws-home-");
  const a = tmp("tah-ws-a-");
  const b = tmp("tah-ws-b-");
  const { make } = hostFactory();
  const first = await make(a);
  const hub = createHub(first);
  await first.open();
  const ws = createWorkspaces({
    cwd: a,
    home,
    host: first,
    hub,
    createHost: make,
    readSessions: async (cwd) => (cwd === b ? [{ id: "old-b", state: "completed", turns: 1, updatedAt: 1, preview: "b" }] : []),
  });
  ws.add(b);
  assert.equal(await ws.renameSession(undefined, "s-a", "x"), "renamed-active");
  assert.equal(await ws.renameSession(b, "old-b", "Named"), "Named");
  await ws.setSessionFlag(b, "old-b", "pinned", true);
  const { loadSessionFlags } = await import("../dist/session-flags.js");
  assert.deepEqual(loadSessionFlags(b).pinned, ["old-b"]);
  await assert.rejects(ws.renameSession(b, "nope", "x"), /no session/);
});

/** Folders `a` (active) and `b` (listed); `fake` is read lazily, so tests set its fields after setup. */
async function twoFolders() {
  const home = tmp("tah-ws-home-");
  const a = tmp("tah-ws-a-");
  const b = tmp("tah-ws-b-");
  const fake: NonNullable<Parameters<typeof hostFactory>[0]> = {};
  const { make, closed } = hostFactory(fake);
  const first = await make(a);
  const hub = createHub(first);
  await first.open();
  const ws = createWorkspaces({ cwd: a, home, host: first, hub, createHost: make, readSessions: async () => [] });
  ws.add(b);
  return { a, b, first, hub, ws, closed, fake };
}

test("activate: a new host whose open() rejects is closed; the old folder stays", async () => {
  const { a, b, first, ws, closed, fake } = await twoFolders();
  fake.gate = () => Promise.reject(new Error("open failed"));
  await assert.rejects(ws.activate(b), /open failed/);
  assert.deepEqual(closed, [b]);
  assert.equal(ws.cwd, a);
  assert.equal(ws.host, first);
});

test("activate: a turn started while the new host opens rejects and closes the new host", async () => {
  const { a, b, first, hub, ws, closed, fake } = await twoFolders();
  let release!: () => void;
  const opening = new Promise<void>((resolve) => (release = resolve));
  fake.gate = () => opening;
  const switching = ws.activate(b);
  hub.start(() => new Promise(() => {}));
  release();
  await assert.rejects(switching, /a turn is running/);
  assert.deepEqual(closed, [b]);
  assert.equal(ws.cwd, a);
  assert.equal(ws.host, first);
});

test("activate: the old host's close() rejecting still switches and is logged", async () => {
  const { a, b, ws, fake } = await twoFolders();
  fake.failClose = a;
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
  try {
    assert.equal(await ws.activate(b), true);
  } finally {
    console.error = original;
  }
  assert.equal(ws.cwd, b);
  assert.deepEqual(errors, [`[tah] closing ${a} failed: close failed`]);
});

test("an unwritable home still starts; the active folder is listed", async () => {
  const home = tmp("tah-ws-home-");
  writeFileSync(path.join(home, ".tah"), "not a folder");
  const a = tmp("tah-ws-a-");
  const { make } = hostFactory();
  const first = await make(a);
  const hub = createHub(first);
  await first.open();
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
  let ws;
  try {
    ws = createWorkspaces({ cwd: a, home, host: first, hub, createHost: make, readSessions: async () => [] });
  } finally {
    console.error = original;
  }
  assert.deepEqual((await ws.list()).map((w) => w.path), [a]);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /^\[tah\] could not save the folder list/);
});
