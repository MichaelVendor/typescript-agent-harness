import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  AttachmentError,
  createAttachmentStore,
  MAX_FILE_BYTES,
} from "../dist/attachments/store.js";
import { composeAttachmentPrompt, parseUserContent } from "../dist/attachments/compose.js";

test("save deduplicates object bytes and returns distinct ids", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-att-"));
  const store = createAttachmentStore(cwd);
  const data = Buffer.from("hello attachments");
  const a = store.save({ name: "a.txt", mime: "text/plain", data });
  const b = store.save({ name: "a.txt", mime: "text/plain", data });
  assert.notEqual(a.id, b.id);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.path, b.path);
  assert.equal(readFileSync(a.path, "utf8"), "hello attachments");
  assert.deepEqual(store.getMany([a.id, b.id]).map((r) => r.id), [a.id, b.id]);
});

test("rejects oversized files and unknown attachment ids", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-att-"));
  const store = createAttachmentStore(cwd);
  assert.throws(
    () => store.save({ name: "big.bin", mime: "application/octet-stream", data: Buffer.alloc(MAX_FILE_BYTES + 1) }),
    (err: unknown) => err instanceof AttachmentError,
  );
  assert.throws(() => store.getMany(["missing"]), /unknown attachment/);
});

test("compose and parse round-trip display text and meta", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-att-"));
  const store = createAttachmentStore(cwd);
  const ref = store.save({ name: "note.txt", mime: "text/plain", data: Buffer.from("x") });
  const composed = composeAttachmentPrompt("Please read this", [ref]);
  assert.match(composed, /Please read this/);
  assert.match(composed, /\[tah-attachments\]:/);
  assert.ok(composed.includes(ref.path));
  const parsed = parseUserContent(composed);
  assert.equal(parsed.text, "Please read this");
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0]?.id, ref.id);
  assert.equal(parsed.attachments[0]?.name, "note.txt");
});
