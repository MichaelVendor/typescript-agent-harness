import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { verifyAgentHostToken, type AgentHostClaims } from "../../../packages/cli/dist/agent-host/auth.js";
import { hashPassword } from "../dist/auth.js";
import { startControl } from "../dist/http.js";
import { createFakeRuntime } from "../dist/runtime.js";
import { openStore } from "../dist/store.js";

const SECRET = "test-shared-secret";
const SSE = "data: {\"n\":1}\n\ndata: {\"n\":2}\n\n";
const BODY_MARKER = "BODY_MARKER_should_not_be_audited";

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

test("member proxy health and SSE; non-member 403; audit stores route not body", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tah-control-proxy-"));
  const dbFile = path.join(dir, "control.db");
  const store = openStore(dbFile);
  const alice = store.createUser("alice", hashPassword("secret"));
  store.createUser("bob", hashPassword("bobpass"));
  const alpha = store.createProject(alice.id, "Alpha");

  const hits: string[] = [];
  const claimsSeen: AgentHostClaims[] = [];
  let postedBody = "";
  const agent = createServer(async (req, res) => {
    hits.push(req.url ?? "");
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(\S+)/i.exec(header);
    assert.ok(match, "missing bearer");
    const claims = verifyAgentHostToken(SECRET, match[1]!, alpha.id);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(claims.exp >= now);
    assert.ok(claims.exp <= now + 15 * 60);
    assert.equal(claims.userId, alice.id);
    claimsSeen.push(claims);

    const pathname = new URL(req.url ?? "/", "http://agent.local").pathname;
    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("health-ok");
      return;
    }
    if (req.method === "POST" && pathname === "/v1/sessions/x/messages") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      postedBody = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.write(SSE.slice(0, 14));
      res.write(SSE.slice(14));
      res.end();
      return;
    }
    res.writeHead(404).end();
  });

  const agentPort = await listen(agent);
  const agentUrl = `http://127.0.0.1:${agentPort}`;
  const runtime = createFakeRuntime();
  runtime.ensure = async (projectId: string) => {
    runtime.calls.push(`ensure:${projectId}`);
    return { baseUrl: agentUrl };
  };

  const { url, stop } = await startControl({
    store,
    runtime,
    secret: SECRET,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const bobLogin = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "bob", password: "bobpass" }),
    });
    assert.equal(bobLogin.status, 200);
    const bobCookie = cookieFrom(bobLogin);

    const forbidden = await fetch(`${url}/api/projects/${alpha.id}/agent/health`, {
      headers: { cookie: bobCookie },
    });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(hits, []);
    assert.deepEqual(runtime.calls, []);

    const login = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const aliceCookie = cookieFrom(login);

    const health = await fetch(`${url}/api/projects/${alpha.id}/agent/health`, {
      headers: { cookie: aliceCookie },
    });
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "health-ok");
    assert.equal(claimsSeen.length, 1);
    assert.equal(claimsSeen[0]!.projectId, alpha.id);

    const messages = await fetch(`${url}/api/projects/${alpha.id}/agent/v1/sessions/x/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: aliceCookie },
      body: JSON.stringify({ text: BODY_MARKER }),
    });
    assert.equal(messages.status, 200);
    assert.match(messages.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(await messages.text(), SSE);
    assert.match(postedBody, new RegExp(BODY_MARKER));
    assert.deepEqual(hits, ["/health", "/v1/sessions/x/messages"]);
    assert.deepEqual(runtime.calls, [
      `ensure:${alpha.id}`,
      `touch:${alpha.id}`,
      `ensure:${alpha.id}`,
      `touch:${alpha.id}`,
    ]);

    const db = new DatabaseSync(dbFile, { readOnly: true });
    const rows = db
      .prepare("SELECT user_id, project_id, route, status FROM audit ORDER BY created_at")
      .all() as { user_id: string; project_id: string; route: string; status: number }[];
    db.close();
    const messageAudit = rows.find((row) => row.route.endsWith("/agent/v1/sessions/x/messages"));
    assert.ok(messageAudit);
    assert.equal(messageAudit.user_id, alice.id);
    assert.equal(messageAudit.project_id, alpha.id);
    assert.equal(messageAudit.status, 200);
    assert.equal(JSON.stringify(rows).includes(BODY_MARKER), false);
  } finally {
    await stop();
    await new Promise<void>((resolve) => agent.close(() => resolve()));
  }
});
