import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SESSION } from "@typescript-agent-harness/agent";
import { parseArgv } from "../dist/args.js";
import {
  bootRuntime,
  listSavedSessions,
  openChatSession,
  openSessionByRef,
} from "../dist/runtime.js";

function flags(cwd: string, argv: string[] = []) {
  return { ...parseArgv([...argv, "chat"]), cwd, mock: true, quiet: true, exec: false };
}

test("parseArgv: --session", () => {
  assert.equal(parseArgv(["chat"]).session, "");
  assert.equal(parseArgv(["--session", "2", "chat"]).session, "2");
  assert.throws(() => parseArgv(["--session"]), /requires a session id or number/);
});

test("tah sessions lists newest first; --session picks by number or id", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sessions-"));
  assert.match(await listSavedSessions(cwd), /no saved sessions/);

  const boot = await bootRuntime(flags(cwd));
  const sessions = boot.runtime.get(SESSION);
  const older = await sessions.create();
  await older.run("first topic");
  await new Promise((r) => setTimeout(r, 5));
  const newer = await sessions.create();
  await newer.run("second topic");
  await boot.runtime.stop();

  const listing = await listSavedSessions(cwd);
  const lines = listing.split("\n");
  assert.match(lines[0]!, new RegExp(`1  ${newer.id}.*second topic`));
  assert.match(lines[1]!, new RegExp(`2  ${older.id}.*first topic`));

  const byNumber = await bootRuntime(flags(cwd, ["--session", "2"]));
  const opened = await openChatSession(byNumber.runtime, flags(cwd, ["--session", "2"]));
  assert.equal(opened.session.id, older.id);
  assert.equal((await openSessionByRef(byNumber.runtime, newer.id)).id, newer.id);
  await assert.rejects(openSessionByRef(byNumber.runtime, "99"), /no session "99"/);
  await byNumber.runtime.stop();
});

test("--session needs persist", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sessions-off-"));
  const f = flags(cwd, ["--no-persist", "--session", "1"]);
  const boot = await bootRuntime(f);
  await assert.rejects(openChatSession(boot.runtime, f), /persist/);
  await boot.runtime.stop();
});
