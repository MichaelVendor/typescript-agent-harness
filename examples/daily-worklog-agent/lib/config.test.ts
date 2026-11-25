import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorklogConfig } from "./config.ts";

test("expands tilde in repos", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "worklog-cfg-"));
  try {
    const p = path.join(dir, "tah.worklog.json");
    writeFileSync(p, JSON.stringify({
      repos: ["~/Desktop/AgentHarness"],
      cursor: { projectsRoot: "~/.cursor/projects" },
      browser: { historyDb: "auto", domainAllowlist: ["github.com"] },
      timezone: "Asia/Shanghai",
    }));
    const c = loadWorklogConfig(p);
    assert.ok(!c.repos[0]!.startsWith("~"));
    assert.equal(c.timezone, "Asia/Shanghai");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});