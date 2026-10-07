import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SESSION } from "@typescript-agent-harness/agent";
import { bootRuntime, openChatSession } from "../dist/runtime.js";
import type { CliFlags } from "../dist/args.js";

function flags(cwd: string, extra: Partial<CliFlags> = {}): CliFlags {
  return {
    command: "chat",
    prompt: "",
    cwd,
    mock: true,
    persist: true,
    quiet: true,
    exec: false,
    mcpCommand: "",
    mcpArgs: [],
    allow: [],
    deny: [],
    onceMs: -1,
    maxSteps: 8,
    ...extra,
  };
}

test("openChatSession resumes the latest persisted session", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-resume-"));
  const first = await bootRuntime(flags(cwd));
  const created = await first.runtime.get(SESSION).create();
  await created.run("hello");
  const id = created.id;
  await first.runtime.stop();

  const second = await bootRuntime(flags(cwd));
  const opened = await openChatSession(second.runtime, flags(cwd));
  assert.equal(opened.resumed, true);
  assert.equal(opened.session.id, id);
  assert.ok(opened.session.messages.some((m) => m.role === "user"));
  await second.runtime.stop();
});

test("openChatSession creates when persist is off", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ephemeral-"));
  const boot = await bootRuntime(flags(cwd, { persist: false }));
  const a = await openChatSession(boot.runtime, flags(cwd, { persist: false }));
  const b = await openChatSession(boot.runtime, flags(cwd, { persist: false }));
  assert.equal(a.resumed, false);
  assert.equal(b.resumed, false);
  assert.notEqual(a.session.id, b.session.id);
  await boot.runtime.stop();
});
