import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgv } from "../dist/args.js";
import { startServe } from "../dist/serve/run.js";

test("review HTTP API binds, reads and clears an offline PR snapshot", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-serve-review-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-serve-review-home-"));
  const githubToken = process.env.GITHUB_TOKEN;
  const ghToken = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  const serve = await startServe(
    { ...parseArgv(["--mock", "--no-exec", "--quiet", "--port", "0", "serve"]), cwd },
    { homeDir: home },
  );
  const url = new URL(serve.url);
  const token = url.searchParams.get("token") ?? "";
  url.search = "";
  try {
    const auth = await fetch(new URL("/api/auth", url), {
      method: "POST",
      headers: { origin: url.origin, "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(auth.status, 204);
    const cookie = auth.headers.get("set-cookie")?.split(";")[0] ?? "";
    const post = (pathname: string, body = {}) =>
      fetch(new URL(pathname, url), {
        method: "POST",
        headers: { cookie, origin: url.origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const get = (pathname: string) => fetch(new URL(pathname, url), { headers: { cookie } });

    assert.equal((await get("/api/review")).status, 404);
    const bind = await post("/api/review/bind", { ref: "acme/app#42" });
    assert.equal(bind.status, 200);
    const snapshot = (await bind.json()) as Record<string, unknown>;
    assert.equal(typeof snapshot.boundAt, "number");
    assert.deepEqual({ ...snapshot, boundAt: 0 }, {
      provider: "github",
      owner: "acme",
      repo: "app",
      number: 42,
      url: "https://github.com/acme/app/pull/42",
      boundAt: 0,
      title: "acme/app#42",
      state: "open",
      files: [],
    });
    assert.ok(existsSync(path.join(cwd, ".tah", "review-binding.json")));
    assert.equal((await get("/api/review")).status, 200);
    assert.equal((await post("/api/review/clear")).status, 204);
    assert.equal((await get("/api/review")).status, 404);
    assert.equal((await post("/api/review/bind", { ref: "bad" })).status, 400);
  } finally {
    await serve.stop();
    if (githubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = githubToken;
    if (ghToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = ghToken;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("review HTTP API binds a GitLab MR with offline mock snapshot", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-serve-review-gl-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-serve-review-gl-home-"));
  const gitlabToken = process.env.GITLAB_TOKEN;
  delete process.env.GITLAB_TOKEN;
  const serve = await startServe(
    { ...parseArgv(["--mock", "--no-exec", "--quiet", "--port", "0", "serve"]), cwd },
    { homeDir: home },
  );
  const url = new URL(serve.url);
  const token = url.searchParams.get("token") ?? "";
  url.search = "";
  try {
    const auth = await fetch(new URL("/api/auth", url), {
      method: "POST",
      headers: { origin: url.origin, "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(auth.status, 204);
    const cookie = auth.headers.get("set-cookie")?.split(";")[0] ?? "";
    const post = (pathname: string, body = {}) =>
      fetch(new URL(pathname, url), {
        method: "POST",
        headers: { cookie, origin: url.origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const get = (pathname: string) => fetch(new URL(pathname, url), { headers: { cookie } });

    const bind = await post("/api/review/bind", { ref: "acme/app!9" });
    assert.equal(bind.status, 200);
    const snapshot = (await bind.json()) as Record<string, unknown>;
    assert.equal(typeof snapshot.boundAt, "number");
    assert.deepEqual({ ...snapshot, boundAt: 0 }, {
      provider: "gitlab",
      owner: "acme",
      repo: "app",
      number: 9,
      url: "https://gitlab.com/acme/app/-/merge_requests/9",
      boundAt: 0,
      title: "acme/app!9",
      state: "open",
      files: [],
    });
    assert.ok(existsSync(path.join(cwd, ".tah", "review-binding.json")));
    assert.equal((await get("/api/review")).status, 200);
  } finally {
    await serve.stop();
    if (gitlabToken === undefined) delete process.env.GITLAB_TOKEN;
    else process.env.GITLAB_TOKEN = gitlabToken;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
