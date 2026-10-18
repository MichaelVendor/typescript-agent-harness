import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hashPassword } from "../dist/auth.js";
import { startControl } from "../dist/http.js";
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
