import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCells, imageKind, imagePaths } from "../src/tui/images.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const cwd = "/proj";

test("imageKind recognizes the four formats", () => {
  assert.equal(imageKind(png), "png");
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0])), "jpeg");
  assert.equal(imageKind(Buffer.from("GIF89a")), "gif");
  const webp = Buffer.alloc(12);
  webp.write("RIFF", 0);
  webp.write("WEBP", 8);
  assert.equal(imageKind(webp), "webp");
  assert.equal(imageKind(Buffer.from("nope")), undefined);
});

test("fitCells keeps aspect and caps at 20 rows", () => {
  assert.deepEqual(fitCells(1, 1, 80), { cols: 1, rows: 1 });
  assert.deepEqual(fitCells(100, 50, 80), { cols: 40, rows: 20 });
  assert.deepEqual(fitCells(50, 100, 80), { cols: 10, rows: 20 });
});

test("imagePaths keeps workspace images and drops the rest", () => {
  const files: Record<string, Buffer> = {
    "/proj/shot.png": png,
    "/proj/.tah/browser/page.png": png,
    "/elsewhere/x.png": png,
  };
  const io = {
    realpath(p: string) {
      if (p === "/proj/link.png") return "/elsewhere/x.png";
      if (!(p in files)) throw new Error("missing");
      return p;
    },
    size: () => 10,
    head: (p: string) => files[p] ?? Buffer.alloc(0),
  };
  const text = [
    "see ![a](shot.png) and .tah/browser/page.png",
    "![b](https://x.dev/a.png) ![c](data:image/png;base64,AA)",
    "shot.png link.png",
    "missing.png /elsewhere/x.png",
  ].join("\n");
  assert.deepEqual(imagePaths(text, cwd, io), ["/proj/shot.png", "/proj/.tah/browser/page.png"]);
});

test("imagePaths stops at 20", () => {
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < 25; i++) files[`/proj/${i}.png`] = png;
  const io = {
    realpath: (p: string) => p,
    size: () => 10,
    head: (p: string) => files[p] ?? Buffer.alloc(0),
  };
  const text = Object.keys(files).join(" ");
  assert.equal(imagePaths(text, cwd, io).length, 20);
});
