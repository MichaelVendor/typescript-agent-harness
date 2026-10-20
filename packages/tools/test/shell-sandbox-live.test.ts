import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Runtime } from "@typescript-agent-harness/core";
import {
  executeCommandTool,
  lookupExecutable,
  type ToolContext,
} from "@typescript-agent-harness/tools";

const helperName =
  process.platform === "darwin"
    ? "sandbox-exec"
    : process.platform === "linux"
      ? "bwrap"
      : "";
const helperPath = helperName ? lookupExecutable(helperName) : undefined;

function liveCtx(): ToolContext {
  return {
    sessionId: "s",
    callId: "c",
    signal: new AbortController().signal,
    runtime: new Runtime({ id: "shell-sandbox-live" }).context(),
  };
}

test(
  "sandboxed node cannot read a file outside the workspace",
  { skip: helperPath === undefined },
  async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "tah-sbx-"));
    const inside = path.join(workspace, "ok.txt");
    writeFileSync(inside, "yes");
    const probe = path.join(
      homedir(),
      `.tah-sandbox-probe-${randomBytes(8).toString("hex")}`,
    );
    writeFileSync(probe, "nope");
    try {
      const tool = executeCommandTool(workspace, {
        sandbox: true,
        platform: process.platform,
      });
      const ctx = liveCtx();
      const denied = await tool.execute(
        {
          program: process.execPath,
          args: [
            "-e",
            `require("node:fs").readFileSync(${JSON.stringify(probe)}, "utf8")`,
          ],
        },
        ctx,
      );
      assert.notEqual(denied.exitCode, 0);
      const ok = await tool.execute(
        {
          program: process.execPath,
          args: [
            "-e",
            `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(inside)}, "utf8"))`,
          ],
        },
        ctx,
      );
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "yes");
    } finally {
      try {
        unlinkSync(probe);
      } catch {
        // probe already removed
      }
    }
  },
);
