import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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
    execSet: false,
    yes: false,
    systemFile: "",
    session: "",
    mcpCommand: "",
    mcpArgs: [],
    allow: [],
    deny: [],
    onceMs: -1,
    maxSteps: 8,
    builtinTools: false,
    install: true,
    plain: false,
    port: 7420,
    open: true,
    watch: true,
    vision: false,
    visionSet: false,
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

test("resumed session picks up a new --system-file", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-system-"));
  const first = await bootRuntime(flags(cwd));
  await (await first.runtime.get(SESSION).create()).run("hello");
  await first.runtime.stop();

  const roleFile = path.join(cwd, "reviewer.md");
  writeFileSync(roleFile, "You are a strict code reviewer.");
  const second = await bootRuntime(flags(cwd, { systemFile: roleFile }));
  const opened = await openChatSession(second.runtime, flags(cwd, { systemFile: roleFile }));
  assert.equal(opened.resumed, true);
  const system = opened.session.messages[0];
  assert.equal(system?.role, "system");
  assert.match(system?.content ?? "", /^You are a strict code reviewer\./);
  assert.equal(opened.session.messages.filter((m) => m.role === "system").length, 1);
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
