import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectBrowser, filterBrowserUrls } from "./collect-browser.ts";

test("domain allowlist keeps github drops others", () => {
  const rows = filterBrowserUrls([
    { url: "https://github.com/a", title: "a" },
    { url: "https://evil.example/x", title: "x" },
  ], ["github.com"]);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.url, /github/);
});

test("allowlist matches subdomains but not lookalike hosts", () => {
  const rows = filterBrowserUrls([
    { url: "https://gist.github.com/a", title: "ok" },
    { url: "https://notgithub.com/a", title: "no" },
    { url: "https://github.com.evil.example/a", title: "no" },
    { url: "http://localhost:3000/x", title: "ok" },
    { url: "not a url", title: "no" },
  ], ["github.com", "localhost"]);
  assert.deepEqual(rows.map((r) => r.title), ["ok", "ok"]);
});

test("empty allowlist drops everything", () => {
  assert.deepEqual(filterBrowserUrls([{ url: "https://github.com/a", title: "a" }], []), []);
});

test("collectBrowser with missing db file reports a gap", () => {
  const r = collectBrowser({
    historyDb: "/nonexistent/History",
    domainAllowlist: ["github.com"],
    date: "2026-11-25",
    timezone: "Asia/Shanghai",
  });
  assert.deepEqual(r.browser, []);
  assert.match(r.gaps[0]!, /^browser:/);
});

test("collectBrowser reads a Chrome-shaped sqlite db and filters", (t) => {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "pipe" });
  } catch {
    t.skip("sqlite3 cli missing");
    return;
  }
  const db = path.join(mkdtempSync(path.join(os.tmpdir(), "wl-br-")), "History");
  // 2026-11-25 10:00 +08:00 = 2026-11-25T02:00:00Z
  const webkit = (iso: string) => (Date.parse(iso) + 11644473600000) * 1000;
  const sql = `
    create table urls(id integer primary key, url text, title text);
    create table visits(id integer primary key, url integer, visit_time integer);
    insert into urls values (1,'https://github.com/x','gh'),(2,'https://evil.example/','ev');
    insert into visits values (1,1,${webkit("2026-11-25T02:00:00Z")}),
      (2,2,${webkit("2026-11-25T03:00:00Z")}),
      (3,1,${webkit("2026-11-26T02:00:00Z")});
  `;
  execFileSync("sqlite3", [db, sql]);
  const r = collectBrowser({
    historyDb: db,
    domainAllowlist: ["github.com"],
    date: "2026-11-25",
    timezone: "Asia/Shanghai",
  });
  assert.deepEqual(r.gaps, []);
  assert.equal(r.browser.length, 1);
  assert.equal(r.browser[0]!.title, "gh");
  assert.equal(r.browser[0]!.visitTime, "2026-11-25T02:00:00.000Z");
});
