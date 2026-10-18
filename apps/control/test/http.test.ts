import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hashPassword } from "../dist/auth.js";
import { startControl } from "../dist/http.js";
import { createFakeRuntime, sweepIdle } from "../dist/runtime.js";
import { openStore } from "../dist/store.js";

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

test("login cookie, member projects only, non-owner cannot add members", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tah-control-http-"));
  const store = openStore(path.join(dir, "control.db"));
  store.createUser("alice", hashPassword("secret"));
  const bob = store.createUser("bob", hashPassword("bobpass"));
  const alpha = store.createProject(store.userByName("alice")!.id, "Alpha");
  store.createProject(bob.id, "Beta");

  const { url, stop } = await startControl({ store, host: "127.0.0.1", port: 0 });
  try {
    const wrong = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "nope" }),
    });
    assert.equal(wrong.status, 401);

    const login = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/);
    const aliceCookie = cookieFrom(login);

    const anon = await fetch(`${url}/api/projects`);
    assert.equal(anon.status, 401);

    const aliceProjects = await fetch(`${url}/api/projects`, {
      headers: { cookie: aliceCookie },
    });
    assert.equal(aliceProjects.status, 200);
    assert.deepEqual(await aliceProjects.json(), [{ id: alpha.id, name: "Alpha", role: "owner" }]);

    const bobLogin = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "bob", password: "bobpass" }),
    });
    assert.equal(bobLogin.status, 200);
    const bobCookie = cookieFrom(bobLogin);

    const add = await fetch(`${url}/api/projects/${alpha.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bobCookie },
      body: JSON.stringify({ username: "alice", role: "member" }),
    });
    assert.equal(add.status, 403);
  } finally {
    await stop();
  }
});

test("member wake is ready and ensure recorded; non-member is 403 and fake unused", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tah-control-wake-"));
  const store = openStore(path.join(dir, "control.db"));
  store.createUser("alice", hashPassword("secret"));
  const bob = store.createUser("bob", hashPassword("bobpass"));
  const alpha = store.createProject(store.userByName("alice")!.id, "Alpha");
  store.createProject(bob.id, "Beta");
  const runtime = createFakeRuntime();

  const { url, stop } = await startControl({ store, runtime, host: "127.0.0.1", port: 0 });
  try {
    const login = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const aliceCookie = cookieFrom(login);

    const wake = await fetch(`${url}/api/projects/${alpha.id}/wake`, {
      method: "POST",
      headers: { cookie: aliceCookie },
    });
    assert.equal(wake.status, 200);
    assert.deepEqual(await wake.json(), { status: "ready" });
    assert.deepEqual(runtime.calls, [`ensure:${alpha.id}`]);

    const bobLogin = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "bob", password: "bobpass" }),
    });
    assert.equal(bobLogin.status, 200);
    const bobCookie = cookieFrom(bobLogin);

    const forbidden = await fetch(`${url}/api/projects/${alpha.id}/wake`, {
      method: "POST",
      headers: { cookie: bobCookie },
    });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(runtime.calls, [`ensure:${alpha.id}`]);
  } finally {
    await stop();
  }
});

test("touch then sweep past idleMs stops the project", () => {
  const runtime = createFakeRuntime();
  const lastTouch = new Map<string, number>();
  const projectId = "proj-idle";
  const idleMs = 30 * 60 * 1000;
  const touchedAt = 1_000;

  runtime.touch(projectId);
  lastTouch.set(projectId, touchedAt);

  sweepIdle(runtime, lastTouch, touchedAt + idleMs - 1, idleMs);
  assert.equal(runtime.calls.includes(`stop:${projectId}`), false);

  sweepIdle(runtime, lastTouch, touchedAt + idleMs, idleMs);
  assert.ok(runtime.calls.includes(`stop:${projectId}`));
});
