import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readImageTextTool } from "../dist/ocr.js";

const mac = process.platform === "darwin";
const ctx = { sessionId: "s", callId: "c", signal: new AbortController().signal, runtime: {} as never };

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-ocr-"));
  copyFileSync(path.join(import.meta.dirname, "fixtures/ocr-hello.png"), path.join(dir, "hello.png"));
  copyFileSync(path.join(import.meta.dirname, "fixtures/ocr-blank.png"), path.join(dir, "blank.png"));
  writeFileSync(path.join(dir, "notes.png"), "not an image");
  return dir;
}

test("read_image_text: reads English and Chinese text from an image", { skip: !mac }, async () => {
  const text = await readImageTextTool(workspace()).execute({ path: "hello.png" }, ctx);
  assert.match(text, /Hello/);
  assert.match(text, /你好/);
});

test("read_image_text: an image without text says so", { skip: !mac }, async () => {
  assert.equal(await readImageTextTool(workspace()).execute({ path: "blank.png" }, ctx), "(no text found in the image)");
});

test("read_image_text: a file that is not an image fails clearly", { skip: !mac }, async () => {
  await assert.rejects(readImageTextTool(workspace()).execute({ path: "notes.png" }, ctx), /not a readable image/);
});

test("read_image_text: paths outside the workspace are refused", async () => {
  await assert.rejects(readImageTextTool(workspace()).execute({ path: "../x.png" }, ctx), /escapes workspace/);
});
