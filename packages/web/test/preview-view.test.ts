import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codeBlock,
  codePath,
  fileQuery,
  linkPath,
  markdownImagePath,
  relativeTo,
  replyImages,
  touchesFiles,
} from "../src/preview-view.ts";

test("inline code that looks like a file path", () => {
  for (const [code, file] of [
    ["src/app.ts", "src/app.ts"],
    ["README.md", "README.md"],
    ["./docs/a.md", "./docs/a.md"],
    ["/Users/me/x/report.html", "/Users/me/x/report.html"],
    ["src/app.ts:12", "src/app.ts"],
    ["src/app.ts:12:5", "src/app.ts"],
    ["package.json", "package.json"],
    ["docs/", "docs/"],
  ] as const) {
    assert.equal(codePath(code), file, code);
  }
  for (const code of ["npm test", "foo.bar()", "useState", "1.5", "a = b", "https://x.dev/a.md", "C:", "'a.md'", "", "x\ny.md", "v0.35"]) {
    assert.equal(codePath(code), null, code);
  }
});

test("markdownImagePath keeps workspace images and drops web addresses", () => {
  assert.equal(markdownImagePath("mouse.svg"), "mouse.svg");
  assert.equal(markdownImagePath("tmp/other.png"), "tmp/other.png");
  assert.equal(markdownImagePath("https://x.dev/a.png"), null);
  assert.equal(markdownImagePath("data:image/png;base64,AA"), null);
  assert.equal(markdownImagePath("readme.md"), null);
});

test("a reply's image paths are kept and web addresses are not", () => {
  const text = [
    "文件位置： `tmp/starry_night.jpg`（1600×1000）",
    "open /Users/me/proj/tmp/starry_night.jpg",
    "saved: tmp/starry_night.jpg",
    "https://x.dev/a.png",
    "![sky](tmp/other.png)",
    "also tmp/panda.svg",
  ].join("\n");
  // Markdown `![…](…)` images render inline; gallery only lists bare paths.
  assert.deepEqual(replyImages(text), [
    "tmp/starry_night.jpg",
    "/Users/me/proj/tmp/starry_night.jpg",
    "tmp/panda.svg",
  ]);
});

test("markdown links to files; web, mail and anchors are not", () => {
  assert.equal(linkPath("docs/a.md"), "docs/a.md");
  assert.equal(linkPath("docs/my%20notes.md"), "docs/my notes.md");
  assert.equal(linkPath("src/app.ts:30"), "src/app.ts");
  assert.equal(linkPath("README.md:30"), "README.md");
  assert.equal(linkPath("src/app.ts#L30"), "src/app.ts");
  assert.equal(linkPath("/abs/report.html"), "/abs/report.html");
  assert.equal(linkPath("https://x.dev:8080"), null);
  for (const href of [undefined, "", "#top", "https://x.dev", "mailto:a@b.c", "//cdn.x/a.js", "file:///a.md"]) {
    assert.equal(linkPath(href), null, String(href));
  }
});

test("relative addresses inside a previewed file resolve against its folder", () => {
  assert.equal(relativeTo("docs/guide/a.md", "img/x.png"), "docs/guide/img/x.png");
  assert.equal(relativeTo("docs/guide/a.md", "./x.png"), "docs/guide/x.png");
  assert.equal(relativeTo("docs/guide/a.md", "../x.png?raw=1"), "docs/x.png");
  assert.equal(relativeTo("a.md", "b.md#part"), "b.md");
  assert.equal(relativeTo("a.md", "/abs/x.png"), "/abs/x.png");
  assert.equal(relativeTo("a.md", "../outside.png"), null);
  assert.equal(relativeTo("a.md", "my%20pic.png"), "my pic.png");
  assert.equal(relativeTo("docs/a.md", "%E6%88%AA%E5%9B%BE.png"), "docs/截图.png");
  assert.equal(relativeTo("a.md", "%2e%2e/x.png"), null);
  for (const src of ["", "https://x.dev/a.png", "data:image/png;base64,AA", "//cdn.x/a.png", "#top"]) {
    assert.equal(relativeTo("a.md", src), null, src);
  }
});

test("code blocks use a fence longer than any backtick run and the extension as language", () => {
  assert.equal(codeBlock("let a = 1", "src/a.ts"), "```ts\nlet a = 1\n```");
  assert.equal(codeBlock("x ``` y", "notes"), "````\nx ``` y\n````");
  assert.equal(codeBlock("a", "weird.c++"), "```\na\n```");
});

test("only finished writes, edits and commands can change files", () => {
  const end = (tool: string) => ({ type: "tool.end" as const, callId: "c", tool, summary: "", ok: true, result: "" });
  assert.equal(touchesFiles(end("write_file")), true);
  assert.equal(touchesFiles(end("edit_file")), true);
  assert.equal(touchesFiles(end("execute_command")), true);
  assert.equal(touchesFiles(end("read_file")), false);
  assert.equal(touchesFiles({ type: "tool.start", callId: "c", tool: "write_file", summary: "" }), false);
  assert.equal(touchesFiles({ type: "text", delta: "x" }), false);
});

test("file queries are encoded", () => {
  assert.equal(fileQuery({ path: "docs/my notes.md" }), "path=docs%2Fmy%20notes.md");
  assert.equal(fileQuery({ attachment: "abc_-1" }), "attachment=abc_-1");
});
