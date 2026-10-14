import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { contentType, fileKind, NotInFolderError, parseRange, resolveInFolder } from "../dist/serve/files.js";

function folder() {
  const root = mkdtempSync(path.join(tmpdir(), "tah-files-"));
  mkdirSync(path.join(root, "docs"));
  writeFileSync(path.join(root, "docs", "a.md"), "# hi");
  const outside = mkdtempSync(path.join(tmpdir(), "tah-files-out-"));
  writeFileSync(path.join(outside, "secret.txt"), "s");
  symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
  symlinkSync(path.join(root, "docs", "a.md"), path.join(root, "inside-link.md"));
  return { root, outside };
}

test("resolveInFolder: relative and absolute paths inside the folder", async () => {
  const { root } = folder();
  const rel = await resolveInFolder(root, "docs/a.md");
  assert.equal(rel.rel, "docs/a.md");
  assert.equal(rel.bytes, 4);
  assert.ok(Number.isInteger(rel.mtime) && rel.mtime > 0);
  assert.equal((await resolveInFolder(root, path.join(root, "docs", "a.md"))).rel, "docs/a.md");
  assert.equal((await resolveInFolder(root, "./docs/../docs/a.md")).rel, "docs/a.md");
  assert.equal((await resolveInFolder(root, "inside-link.md")).rel, "docs/a.md");
});

test("resolveInFolder: outside, symlinked out, directories and missing files are all not found", async () => {
  const { root, outside } = folder();
  const bad = [
    path.relative(root, path.join(outside, "secret.txt")),
    path.join(outside, "secret.txt"),
    "link.txt",
    "docs",
    "",
    "missing.txt",
  ];
  for (const file of bad) {
    await assert.rejects(resolveInFolder(root, file), (err: unknown) => {
      assert.ok(err instanceof NotInFolderError, file);
      assert.equal((err as Error).message, "not found in this folder");
      return true;
    });
  }
});

test("resolveInFolder: an unreadable file is not found", { skip: process.getuid?.() === 0 }, async () => {
  const { root } = folder();
  writeFileSync(path.join(root, "locked.txt"), "x");
  chmodSync(path.join(root, "locked.txt"), 0o000);
  await assert.rejects(resolveInFolder(root, "locked.txt"), NotInFolderError);
});

test("fileKind: a file that is gone is not found", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tah-kind-"));
  await assert.rejects(fileKind(path.join(root, "missing.txt")), NotInFolderError);
});

test("fileKind: by extension, else by a NUL byte in the first 8KB", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tah-kind-"));
  const file = (name: string, data: string | Buffer = "x") => {
    writeFileSync(path.join(root, name), data);
    return path.join(root, name);
  };
  assert.equal(await fileKind(file("a.PNG")), "image");
  assert.equal(await fileKind(file("a.svg")), "image");
  assert.equal(await fileKind(file("a.pdf")), "pdf");
  assert.equal(await fileKind(file("a.mov")), "video");
  assert.equal(await fileKind(file("a.htm")), "html");
  assert.equal(await fileKind(file("a.markdown")), "markdown");
  assert.equal(await fileKind(file("a.ts", "export {}")), "text");
  assert.equal(await fileKind(file("Makefile", "all:\n")), "text");
  assert.equal(await fileKind(file("empty.dat", "")), "text");
  assert.equal(await fileKind(file("a.bin", Buffer.from([1, 0, 2]))), "binary");
  assert.equal(await fileKind(file("late-nul.txt", Buffer.concat([Buffer.alloc(9000, 65), Buffer.from([0])]))), "text");
});

test("contentType: known extensions, else text/plain or octet-stream by kind", () => {
  assert.equal(contentType("/x/a.md", "markdown"), "text/markdown; charset=utf-8");
  assert.equal(contentType("/x/a.css", "text"), "text/css; charset=utf-8");
  assert.equal(contentType("/x/a.pdf", "pdf"), "application/pdf");
  assert.equal(contentType("/x/a.mov", "video"), "video/quicktime");
  assert.equal(contentType("/x/Makefile", "text"), "text/plain; charset=utf-8");
  assert.equal(contentType("/x/a.bin", "binary"), "application/octet-stream");
});

test("parseRange: one bytes= range; anything else is unsatisfiable", () => {
  assert.equal(parseRange(undefined, 10), undefined);
  assert.deepEqual(parseRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange("bytes=8-", 10), { start: 8, end: 9 });
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange("bytes=-30", 10), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=0-99", 10), { start: 0, end: 9 });
  for (const bad of ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=-", "bytes=0-1,4-5", "items=0-1", "bytes=a-b"]) {
    assert.equal(parseRange(bad, 10), null, bad);
  }
  assert.equal(parseRange("bytes=0-", 0), null);
});
