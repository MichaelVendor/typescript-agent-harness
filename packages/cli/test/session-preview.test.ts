import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { composeAttachmentPrompt } from "../dist/attachments/compose.js";
import { createAttachmentStore } from "../dist/attachments/store.js";
import { setSessionFlag } from "../dist/session-flags.js";
import { setSessionTitle } from "../dist/session-titles.js";
import { displayUserText, sessionPreview, toRows } from "../dist/sessions.js";

test("sessionPreview prefers text, then file names, never bare (attachments)", () => {
  assert.equal(sessionPreview("hello world", []), "hello world");
  assert.equal(sessionPreview("(attachments)", [{ id: "1", kind: "file", name: "note.txt", mime: "text/plain", bytes: 1, sha256: "a" }]), "note.txt");
  assert.equal(
    sessionPreview("", [
      { id: "1", kind: "image", name: "a.png", mime: "image/png", bytes: 1, sha256: "a" },
      { id: "2", kind: "file", name: "b.pdf", mime: "application/pdf", bytes: 2, sha256: "b" },
    ]),
    "a.png +1",
  );
  assert.equal(sessionPreview("", []), "New chat");
  assert.equal(displayUserText("(attachments)"), "");
  assert.equal(displayUserText("hi"), "hi");
});

test("toRows uses attachment names and custom titles", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-preview-"));
  const store = createAttachmentStore(cwd);
  const ref = store.save({ name: "shot.png", mime: "image/png", data: Buffer.from("x") });
  const content = composeAttachmentPrompt("", [ref]);
  const rows = toRows(
    [
      {
        id: "session_1",
        status: "completed",
        maxSteps: 32,
        messagesJson: JSON.stringify([{ role: "user", content }]),
        stepsJson: "[]",
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    cwd,
  );
  assert.equal(rows[0]?.preview, "shot.png");
  assert.equal(rows[0]?.title, undefined);

  setSessionTitle(cwd, "session_1", "My screenshot");
  const titled = toRows(
    [
      {
        id: "session_1",
        status: "completed",
        maxSteps: 32,
        messagesJson: JSON.stringify([{ role: "user", content }]),
        stepsJson: "[]",
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    cwd,
  );
  assert.equal(titled[0]?.title, "My screenshot");
  assert.match(readFileSync(path.join(cwd, ".tah", "session-titles.json"), "utf8"), /My screenshot/);
});

test("toRows reports pinned / archived; archiving unpins", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-flags-"));
  const row = (id: string) => ({
    id,
    status: "completed",
    maxSteps: 32,
    messagesJson: JSON.stringify([{ role: "user", content: id }]),
    stepsJson: "[]",
    createdAt: 1,
    updatedAt: 2,
  });
  const rows = () => toRows([row("a"), row("b")], cwd);

  setSessionFlag(cwd, "a", "pinned", true);
  setSessionFlag(cwd, "b", "pinned", true);
  assert.equal(rows()[0]?.pinned, true);
  assert.equal(rows()[1]?.pinned, true);

  setSessionFlag(cwd, "b", "archived", true);
  assert.equal(rows()[1]?.archived, true);
  assert.equal(rows()[1]?.pinned, undefined);

  setSessionFlag(cwd, "a", "pinned", false);
  setSessionFlag(cwd, "b", "archived", false);
  assert.deepEqual(
    rows().map((r) => [r.pinned, r.archived]),
    [
      [undefined, undefined],
      [undefined, undefined],
    ],
  );
});
