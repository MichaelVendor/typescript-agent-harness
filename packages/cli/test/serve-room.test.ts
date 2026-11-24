import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { matchesMessageSubsequence, type RoomMessage } from "@typescript-agent-harness/agent";
import { parseArgv } from "../dist/args.js";
import { startServe } from "../dist/serve/run.js";

function raw(
  base: string,
  method: string,
  pathname: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = request(base, { method, path: pathname, headers: opts.headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
      );
    });
    req.on("error", reject);
    req.end(body);
  });
}

function client(base: string, cookie = "") {
  const origin = base.replace(/\/$/, "");
  return {
    get: (pathname: string) => raw(base, "GET", pathname, { headers: { cookie } }),
    post: (pathname: string, body: unknown = {}) =>
      raw(base, "POST", pathname, {
        headers: { cookie, origin, "content-type": "application/json" },
        body,
      }),
  };
}

test("parseArgv --room", () => {
  const flags = parseArgv(["serve", "--room"]);
  assert.equal(flags.room, true);
});

test("serve --room --mock: room routes 404 without flag", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-serve-noroom-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-serve-noroom-home-"));
  const serve = await startServe(
    { ...parseArgv(["serve", "--mock", "--no-exec", "--quiet", "--port", "0", "--no-open"]), cwd },
    { homeDir: home },
  );
  const base = serve.url.replace(/\?.*$/, "");
  const token = new URL(serve.url).searchParams.get("token") ?? "";
  try {
    const signed = await client(base).post("/api/auth", { token });
    assert.equal(signed.status, 204);
    const cookie = String(signed.headers["set-cookie"]).split(";")[0] ?? "";
    const api = client(base, cookie);
    assert.equal((await api.get("/api/room")).status, 404);
    const info = JSON.parse((await api.get("/api/info")).body) as { room?: true };
    assert.equal(info.room, undefined);
  } finally {
    await serve.stop();
  }
});

test("serve --room --mock: goal + step yields messages", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-serve-room-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-serve-room-home-"));
  const flags = {
    ...parseArgv(["serve", "--room", "--mock", "--no-exec", "--quiet", "--port", "0", "--no-open"]),
    cwd,
  };
  const serve = await startServe(flags, { homeDir: home });
  const base = serve.url.replace(/\?.*$/, "");
  const token = new URL(serve.url).searchParams.get("token") ?? "";
  try {
    const signed = await client(base).post("/api/auth", { token });
    assert.equal(signed.status, 204);
    const cookie = String(signed.headers["set-cookie"]).split(";")[0] ?? "";
    const api = client(base, cookie);
    assert.equal(JSON.parse((await api.get("/api/info")).body).room, true);
    assert.equal((await api.post("/api/room/goal", { text: "hello room" })).status, 200);
    await api.post("/api/room/step");
    await api.post("/api/room/step");
    const stepped = await api.post("/api/room/step");
    const snap = JSON.parse(stepped.body) as { meta: { status: string }; messages: RoomMessage[] };
    assert.equal(snap.meta.status, "done");
    assert.ok(
      matchesMessageSubsequence(snap.messages, [
        { from: "user", kind: "chat" },
        { from: "tl", kind: "delegate" },
        { from: "researcher", kind: "result" },
        { from: "tl", kind: "status" },
      ]),
    );
  } finally {
    await serve.stop();
  }
});