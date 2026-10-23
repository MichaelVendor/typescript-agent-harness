import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transcript } from "../dist/tui/transcript.js";
import { pastedImagePaths, readClipboard } from "../dist/tui/clipboard.js";
import { encodeImage, fitCells, imageKind, imagePaths, imageProtocol } from "../src/tui/images.ts";
import { renderMarkdown } from "../src/markdown.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const cwd = "/proj";
const png1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

test("imageProtocol follows the terminal", () => {
  assert.equal(imageProtocol({ KITTY_WINDOW_ID: "1" }), "kitty");
  assert.equal(imageProtocol({ TERM_PROGRAM: "ghostty" }), "kitty");
  assert.equal(imageProtocol({ TERM: "xterm-kitty" }), "kitty");
  assert.equal(imageProtocol({ WEZTERM_EXECUTABLE: "/wezterm" }), "kitty");
  assert.equal(imageProtocol({ TERM_PROGRAM: "WezTerm" }), "kitty");
  assert.equal(imageProtocol({ TERM_PROGRAM: "vscode" }), "iterm");
  assert.equal(imageProtocol({ TERM_PROGRAM: "iTerm.app" }), "iterm");
  assert.equal(imageProtocol({ WT_SESSION: "1" }), "sixel");
  assert.equal(imageProtocol({ TERM: "foot" }), "sixel");
  assert.equal(imageProtocol({ TERM: "xterm-256color" }), "none");
  assert.equal(imageProtocol({ TERM_PROGRAM: "vscode", KITTY_WINDOW_ID: "1" }), "kitty");
});

test("encodeImage writes the protocol or nothing", () => {
  const kitty = encodeImage({ protocol: "kitty", bytes: png1, columns: 80 });
  assert.equal(kitty.split("\n").length, 1);
  assert.ok(kitty.includes("\u{10EEEE}"));
  assert.ok(kitty.includes(png1.toString("base64")));
  const iterm = encodeImage({ protocol: "iterm", bytes: png1, columns: 80 });
  assert.match(iterm, /\x1b\]1337;File=.*height=1;/);
  assert.ok(iterm.endsWith("\n"));
  const sixel = encodeImage({ protocol: "sixel", bytes: png1, columns: 80 });
  assert.match(sixel, /^\x1bPq/);
  assert.match(sixel, /#\d+;2;\d+;\d+;\d+#\d+@/);
  assert.equal(encodeImage({ protocol: "none", bytes: png1, columns: 80 }), "");
  assert.equal(encodeImage({ protocol: "kitty", bytes: Buffer.from([0xff, 0xd8, 0xff]), columns: 80 }), "");
  assert.equal(renderMarkdown("![a](shot.png)").includes("\x1b]1337"), false);
  assert.equal(renderMarkdown("![a](shot.png)").includes("\x1b_G"), false);
});

test("kitty image ids stay within 1..255 and wrap", () => {
  const ids: number[] = [];
  for (let i = 0; i < 256; i++) {
    const out = encodeImage({ protocol: "kitty", bytes: png1, columns: 80 });
    const id = Number(/,i=(\d+),/.exec(out)![1]);
    assert.ok(out.includes(`\x1b[38;5;${id}m`));
    ids.push(id);
  }
  assert.ok(ids.every((id) => id >= 1 && id <= 255));
  assert.ok(ids.includes(255));
  assert.equal(ids[255], ids[0]);
});

test("pastedImagePaths accepts only an all-image paste", () => {
  const ok = (p: string) => p === "/tmp/a.png" || p === "shot.jpeg";
  assert.deepEqual(pastedImagePaths("/tmp/a.png shot.jpeg", ok), ["/tmp/a.png", "shot.jpeg"]);
  assert.equal(pastedImagePaths("/tmp/a.png and more", ok), undefined);
  assert.equal(pastedImagePaths("   ", ok), undefined);
});

test("readClipboard picks the platform command", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const seen: string[] = [];
  let darwinScript: string | undefined;
  const run = async (file: string, args: string[]) => {
    seen.push(`${file} ${args[0] ?? ""}`);
    if (file === "wl-paste") return { stdout: Buffer.alloc(0), code: 127, missing: true };
    if (file === "xclip") return { stdout: png, code: 0 };
    if (file === "osascript") {
      const eIdx = args.indexOf("-e");
      if (eIdx >= 0) darwinScript = args[eIdx + 1];
      return { stdout: Buffer.from(png.toString("base64")), code: 0 };
    }
    if (file === "powershell.exe") return { stdout: png, code: 0 };
    return { stdout: Buffer.alloc(0), code: 1 };
  };
  assert.deepEqual(await readClipboard("darwin", run), { bytes: png });
  assert.ok(darwinScript);
  assert.equal(darwinScript!.includes("print("), false);
  assert.equal(darwinScript!.includes("base64EncodedStringWithOptions"), true);
  assert.deepEqual(await readClipboard("linux", run), { bytes: png });
  assert.equal(seen.includes("wl-paste --type"), true);
  assert.equal(seen.includes("xclip -selection"), true);
  assert.deepEqual(await readClipboard("win32", run), { bytes: png });
  const missing = async () => ({ stdout: Buffer.alloc(0), code: 127, missing: true });
  assert.deepEqual(await readClipboard("linux", missing), { error: "image clipboard unavailable" });
  const empty = async () => ({ stdout: Buffer.alloc(0), code: 1 });
  assert.deepEqual(await readClipboard("darwin", empty), { error: "clipboard has no image" });
});

test("kitty grid never exceeds the diacritics table", () => {
  const wide = Buffer.from(png1);
  wide.writeUInt32BE(10000, 16);
  wide.writeUInt32BE(20, 20);
  const out = encodeImage({ protocol: "kitty", bytes: wide, columns: 1000 });
  assert.ok(Number(/,c=(\d+),/.exec(out)![1]) <= 297);
  const firstRow = out.slice(out.indexOf("\x1b\\") + 2).split("\n")[0]!;
  assert.equal(firstRow.split("\u{10EEEE}").length - 1, 297);
});

test("a user image and a tool path become protocol sequences", () => {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "tah-img-")));
  const shot = path.join(cwd, "shot.png");
  writeFileSync(shot, png1);
  const painter = {
    cwd,
    columns: () => 80,
    protocol: "iterm" as const,
    readFile: (p: string) => (p === shot ? png1 : undefined),
    attachmentPath: (id: string) => (id === "a" ? shot : undefined),
  };
  const transcript = new Transcript((s) => s, painter);
  transcript.apply({
    type: "user",
    text: "look",
    attachments: [{ id: "a", kind: "image", name: "shot.png", mime: "image/png", bytes: png1.length, sha256: "abc" }],
  });
  transcript.apply({ type: "tool.end", callId: "1", tool: "browser_take_screenshot", ok: true, summary: "page", result: `saved ${shot}` });
  const items = transcript.snapshot.items;
  const user = items.find((i) => i.kind === "user");
  const tool = items.find((i) => i.kind === "tool");
  assert.match(user && "images" in user ? user.images ?? "" : "", /\x1b\]1337/);
  assert.match(tool && "images" in tool ? tool.images ?? "" : "", /\x1b\]1337/);
});

test("without a painter nothing is drawn; summaries are not scanned; failures skip", () => {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "tah-img-")));
  const shot = path.join(cwd, "shot.png");
  writeFileSync(shot, png1);
  const plain = new Transcript((s) => s);
  plain.apply({ type: "text", delta: `see ${shot}\n\n` });
  plain.apply({ type: "turn.end", rounds: 1, finishReason: "stop" } as never);
  plain.apply({ type: "tool.end", callId: "1", tool: "t", ok: true, summary: shot, result: shot });
  assert.ok(plain.snapshot.items.length > 0);
  assert.ok(plain.snapshot.items.every((i) => !("images" in i)));

  const throwing = {
    cwd,
    columns: () => 80,
    protocol: "iterm" as const,
    readFile: (): Buffer => {
      throw new Error("boom");
    },
    attachmentPath: () => shot,
  };
  const t = new Transcript((s) => s, throwing);
  t.apply({ type: "tool.end", callId: "1", tool: "t", ok: true, summary: shot, result: "no path" });
  t.apply({ type: "user", text: "x", attachments: [{ id: "a", kind: "image", name: "s", mime: "image/png", bytes: 1, sha256: "a" }] });
  assert.ok(t.snapshot.items.every((i) => !("images" in i)));
});

test("imagePaths accepts a file under a symlinked cwd", () => {
  const real = realpathSync(mkdtempSync(path.join(tmpdir(), "tah-real-")));
  const link = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), "tah-link-"))), "ws");
  symlinkSync(real, link);
  const shot = path.join(real, "shot.png");
  writeFileSync(shot, png1);
  const io = { realpath: (p: string) => realpathSync(p), size: () => png1.length, head: () => png1 };
  assert.deepEqual(imagePaths(`see ${shot}`, link, io), [shot]);
  assert.deepEqual(imagePaths("see shot.png", link, io), [shot]);
});
