import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSqliteStorage } from "../dist/sqlite.js";

test("listSessions returns the message head and skips steps_json", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-sqlite-"));
  try {
    const storage = createSqliteStorage(path.join(dir, "cli.db"));
    const messages = JSON.stringify([{ role: "user", content: "hello" }]);
    await storage.saveSession({
      id: "s1",
      status: "completed",
      maxSteps: 8,
      messagesJson: messages,
      stepsJson: "x".repeat(2_000_000),
      createdAt: 1,
      updatedAt: 2,
    });

    const rows = await storage.listSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.messagesHead, messages);
    assert.equal(rows[0]?.messagesChars, messages.length);
    assert.equal("stepsJson" in (rows[0] ?? {}), false);
    assert.equal(await storage.hasSession("s1"), true);
    assert.equal(await storage.hasSession("missing"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
