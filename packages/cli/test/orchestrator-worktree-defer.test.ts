import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import type { ChatHost, HostEvent } from "../dist/host.js";
import { createOrchestrator, type Orchestrator } from "../dist/serve/orchestrator.js";
import { worktreePath } from "../dist/serve/worktree.js";

function fakeMain(sessionId = "main-session") {
  const listeners = new Set<(e: HostEvent) => void>();
  const snap = { type: "session" as const, id: sessionId, resumed: false, history: [], hiddenTurns: 0 };
  const host = {
    sessionId,
    snapshot: () => snap,
    on(l: (e: HostEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async send() {},
    cancel() {},
  } as unknown as ChatHost;
  return { host };
}

function harness(repo: string, home: string) {
  const main = fakeMain();
  const workers: { cwd: string }[] = [];
  const servers: Server[] = [];
  const spawnWorker = async ({ cwd, token }: { id: string; cwd: string; token: string }) => {
    const sse = new Set<ServerResponse>();
    const server = createServer((req, res) => {
      const route = new URL(req.url ?? "/", "http://x").pathname;
      if (route === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("retry: 1000\n\n");
        sse.add(res);
        req.on("close", () => sse.delete(res));
        return;
      }
      if (route === "/session") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "session", id: `sess-${cwd}`, resumed: false, history: [], hiddenTurns: 0 }));
        return;
      }
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => res.writeHead(202).end());
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    workers.push({ cwd });
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      kill() {
        for (const res of sse) res.end();
        server.closeAllConnections();
        server.close();
      },
    };
  };
  const orch: Orchestrator = createOrchestrator({
    main: main.host,
    mainCwd: repo,
    flags: parseArgv(["--mock"]),
    homeDir: home,
    spawnWorker,
  });
  return {
    orch,
    workers,
    async close() {
      await orch.dispose();
      for (const s of servers) s.closeAllConnections();
    },
  };
}

test("defer worktree: no directory until first send", async () => {
  const repo = await realpath(await mkdtemp(path.join(tmpdir(), "tah-wt-")));
  const home = await mkdtemp(path.join(tmpdir(), "tah-home-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "i");
  const h = harness(repo, home);
  try {
    const wtDir = worktreePath(repo, "feat");
    const w = await h.orch.parallel({ name: "feat", deferUntilSend: true });
    assert.equal(existsSync(wtDir), false);
    assert.equal(w.cwd, wtDir);
    assert.equal(execFileSync("git", ["branch", "--list", "tah/feat"], { cwd: repo }).toString().trim(), "");
    assert.equal(h.workers[0]?.cwd, repo);

    await h.orch.send(w.id, "hello");
    assert.equal(existsSync(wtDir), true);
    assert.match(execFileSync("git", ["branch", "--list", "tah/feat"], { cwd: repo }).toString(), /tah\/feat/);
    assert.equal(h.workers[h.workers.length - 1]?.cwd, wtDir);
  } finally {
    await h.close();
  }
});

test("defer worktree: remove before send leaves no worktree", async () => {
  const repo = await realpath(await mkdtemp(path.join(tmpdir(), "tah-wt-")));
  const home = await mkdtemp(path.join(tmpdir(), "tah-home-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "i");
  const h = harness(repo, home);
  try {
    const wtDir = worktreePath(repo, "draft");
    const w = await h.orch.parallel({ name: "draft", deferUntilSend: true });
    assert.equal(existsSync(wtDir), false);
    await h.orch.remove(w.id);
    assert.equal(existsSync(wtDir), false);
    assert.equal(execFileSync("git", ["branch", "--list", "tah/draft"], { cwd: repo }).toString().trim(), "");
  } finally {
    await h.close();
  }
});