# 文件预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话里的文件路径可以点，在 `tah serve` 网页右侧的面板里只读预览（图片、PDF、视频、HTML、Markdown、代码 / 文本）。

**Architecture:** 全部在 Application 层。`packages/cli` 的 host 给文件类工具事件加 `path`；`serve/files.ts` 负责「路径必须在当前工作文件夹内」、文件类型判断和带 `Range` 的流式发送；`serve/http.ts` 加 `GET /api/files/stat`、`GET /api/files/raw`（登录 cookie）和 `GET /preview/<预览令牌>/<相对路径>`（HTML 用，CSP sandbox 不透明来源）。`packages/web` 加纯函数 `preview-view.ts` 和面板组件 `FilePreview.tsx`。

**Tech Stack:** TypeScript（NodeNext、strict、`exactOptionalPropertyTypes`）、`node:http`、React 19、react-markdown 10、rehype-highlight 7、`node --test --experimental-strip-types`。

**Spec:** `docs/design/file-preview.md`

    10|## Global Constraints

- 只改 `packages/cli/src/host.ts`、`packages/cli/src/index.ts`、`packages/cli/src/serve/*`、`packages/web/**` 和文档；`core` / `agent` / `tools` / `llm` / `mcp` / `permissions` / `storage` / `scheduler` 和 `apps/desktop` 一行不改。不给模型加工具。
- 三个接口只读，只限当前工作文件夹（`workspaces.cwd`）；文件和文件夹都先 `realpath` 再比较；出界、不存在、是目录、读不了：一律 404 `{"error":"not found in this folder"}`。
- `/preview` 的 CSP 原文：`sandbox allow-scripts allow-forms allow-popups allow-modals`；网页 iframe 的 `sandbox` 属性同样是 `allow-scripts allow-forms allow-popups allow-modals`。两处都**不能**有 `allow-same-origin`。
- `raw` 除 PDF 外带 `content-security-policy: sandbox`；所有文件响应带 `x-content-type-options: nosniff`、`cache-control: no-cache`、`accept-ranges: bytes`。
- 预览令牌：`crypto.randomBytes(32).toString("base64url")`（43 字符），在 `createServeHandler` 里生成，和登录令牌分开，比较用现有 `sameToken`（`timingSafeEqual`）。
- 网页只通过 `api.ts` 发请求；不用 `dangerouslySetInnerHTML`、不用 `rehype-raw`；SVG 只用 `<img>` 显示。
- 面板文字用英文（和网页其他部分一致）：`Not found in this folder`、`This file was deleted`、`File too large — showing the first 1 MB`、`No preview for this file`。
- 文本类内容只取前 1MB（`Range: bytes=0-1048575`），超过 256KB 不高亮；空文件不请求。
    20|- 测试用临时目录 / 临时 HOME，不碰真实 `~/.tah`。cli 测试 import `../dist`，跑之前先 build。
- 提交走 `~/.cursor/skills/code-commit/SKILL.md`；不 push；不 `--no-verify`；不提交 `.superpowers/`。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `packages/cli/src/host.ts` | `toolPath()`；`tool.start` / `tool.end` 事件和历史工具条目带 `path` |
| `packages/cli/src/serve/files.ts`（新） | `resolveInFolder`、`fileKind`、`contentType`、`parseRange`、`sendFile`、`NotInFolderError` |
| `packages/cli/src/serve/protocol.ts` | `FileKind`、`FileStat` 类型 |
    30|| `packages/cli/src/index.ts` | 导出 `FileKind`、`FileStat` |
| `packages/cli/src/serve/http.ts` | 三个路由、预览令牌、`NotInFolderError` → 404 |
| `packages/web/src/preview-view.ts`（新） | 纯函数：`FileTarget`、`fileQuery`、`codePath`、`linkPath`、`relativeTo`、`codeBlock`、`touchesFiles` |
| `packages/web/src/state.ts` | 工具条目带 `path` |
| `packages/web/src/api.ts` | `fileStat`、`fileRawURL`、`fileText` |
| `packages/web/src/components/FilePreview.tsx`（新） | 面板 |
| `packages/web/src/components/Messages.tsx`、`ToolLine.tsx` | 路径可点 |
| `packages/web/src/App.tsx`、`styles.css` | 面板挂载、刷新、布局 |
| `docs/design/serve.md`、`docs/design/file-preview.md`、`CHANGELOG.md` | 文档 |

    40|---

### Task 1: 工具事件带完整路径

**Files:**
- Modify: `packages/cli/src/host.ts`
- Test: `packages/cli/test/host.test.ts`

**Interfaces:**
- Produces: `export function toolPath(tool: string, input: unknown): string | undefined`；`HostEvent` 的 `tool.start` / `tool.end` 和 `HistoryItem` 的 `role: "tool"` 多一个可选字段 `path?: string`（只有 `read_file`、`write_file`、`edit_file`、`read_image_text` 带）。

    50|- [ ] **Step 1: 写失败的测试**

`packages/cli/test/host.test.ts`：import 里加 `toolPath`（和 `toolSummary` 放一起）。

把 `historyOf keeps the last turns…` 测试里的期望改为带 `path`：

```ts
    { role: "tool", callId: "c1", tool: "read_file", summary: "a.md", ok: true, result: "2 lines", path: "a.md" },
```

    60|文件末尾追加：

```ts
test("file tools carry their full path; other tools do not", () => {
  const long = `src/${"deep/".repeat(20)}file.ts`;
  assert.equal(toolPath("write_file", { path: long }), long);
  assert.equal(toolPath("read_image_text", { path: "shot.png" }), "shot.png");
  assert.equal(toolPath("list_files", { directory: "src" }), undefined);
  assert.equal(toolPath("read_file", {}), undefined);
  assert.equal(toolPath("read_file", null), undefined);
  assert.equal(toolSummary("write_file", { path: long }).length, 60);
    70|});

test("tool events carry the path of file tools", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-host-"));
  writeFileSync(path.join(cwd, "README.md"), "# hi\n");
  const { host, events } = await openHost(cwd, ["--quiet"]);
  try {
    await host.send("看看");
    const tools = events.filter((e) => e.type === "tool.start" || e.type === "tool.end");
    const read = tools.filter((e) => "tool" in e && e.tool === "read_file");
    80|    assert.equal(read.length, 2);
    for (const e of read) assert.equal((e as { path?: string }).path, "README.md");
    for (const e of tools.filter((e) => "tool" in e && e.tool === "list_files")) assert.equal("path" in e, false);
    const history = host.snapshot().history.filter((h) => h.role === "tool");
    assert.deepEqual(
      history.map((h) => (h.role === "tool" ? [h.tool, h.path] : [])),
      [
        ["list_files", undefined],
        ["read_file", "README.md"],
      ],
    90|    );
  } finally {
    await host.close();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/host.test.ts`
Expected：FAIL（`toolPath` 不是导出的函数 / `path` 不存在）。
   100|
- [ ] **Step 3: 实现**

`packages/cli/src/host.ts`：

1. 类型（替换 `HistoryItem` 的 tool 行和 `HostEvent` 的两行）：

```ts
  | { role: "tool"; callId: string; tool: string; summary: string; ok: boolean; result: string; path?: string };
```

   110|```ts
  | { type: "tool.start"; callId: string; tool: string; summary: string; path?: string }
  | { type: "tool.end"; callId: string; tool: string; summary: string; ok: boolean; result: string; path?: string }
```

2. `toolSummary` 前面加：

```ts
const PATH_TOOLS = new Set(["read_file", "write_file", "edit_file", "read_image_text"]);

   120|/** A file tool's full `path` (front ends open it; `summary` is clipped). */
export function toolPath(tool: string, input: unknown): string | undefined {
  if (!PATH_TOOLS.has(tool)) return undefined;
  const value = (input as { path?: unknown } | null | undefined)?.path;
  return typeof value === "string" && value ? value : undefined;
}
```

3. `historyOf` 里 push 工具条目改为：

   130|```ts
      const file = toolPath(call.name, call.arguments);
      history.push({
        role: "tool",
        callId: call.id,
        tool: call.name,
        summary: toolSummary(call.name, call.arguments),
        ok,
        result: toolResult(call.name, ok, output),
        ...(file ? { path: file } : {}),
   140|      });
```

4. `createChatHost` 里把 `summaries` 换成存 `{ summary, path? }`（审批时被拒的调用不会有 `tool.started`，所以审批时也要记）：

```ts
  /** A call rejected at approval never starts, so how it is shown is kept from the question. */
  const calls = new Map<string, { summary: string; path?: string }>();
  const describe = (tool: string, input: unknown) => {
    const file = toolPath(tool, input);
    return { summary: toolSummary(tool, input), ...(file ? { path: file } : {}) };
   150|  };
  const ask = rememberAlways((call, signal) => {
    calls.set(call.id, describe(call.name, call.arguments));
    return approvals.ask(call, signal);
  });
  const toolEnd = (callId: string, tool: string, ok: boolean, output: unknown) => {
    const call = calls.get(callId) ?? { summary: "" };
    calls.delete(callId);
    emit({ type: "tool.end", callId, tool, ...call, ok, result: toolResult(tool, ok, output) });
  };
   160|```

`tool.started` 监听改为：

```ts
    runtime.on("tool.started", (e) => {
      const p = e as { callId: string; tool: string; input: unknown };
      const call = describe(p.tool, p.input);
      calls.set(p.callId, call);
      emit({ type: "tool.start", callId: p.callId, tool: p.tool, ...call });
    });
   170|```

文件里其他用到 `summaries` 的地方（如果有）一并改成 `calls`。TUI（`tui/transcript.ts`）逐个字段取值，不用改。

- [ ] **Step 4: 跑测试确认通过**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/host.test.ts test/tui.test.ts`
Expected：PASS。

- [ ] **Step 5: 提交**

   180|按 code-commit 技能提交 `packages/cli/src/host.ts`、`packages/cli/test/host.test.ts`。参考信息：`feat(cli): 文件类工具事件带完整路径`。

---

### Task 2: `serve/files.ts`：文件夹内的路径、类型和流式发送

**Files:**
- Create: `packages/cli/src/serve/files.ts`
- Modify: `packages/cli/src/serve/protocol.ts`（加 `FileKind`）
- Test: `packages/cli/test/serve-files.test.ts`
   190|
**Interfaces:**
- Produces（`packages/cli/src/serve/protocol.ts`）：

```ts
/** How the preview panel shows a file. */
export type FileKind = "image" | "pdf" | "video" | "html" | "markdown" | "text" | "binary";
```

- Produces（`packages/cli/src/serve/files.ts`）：
  - `class NotInFolderError extends Error`（message 固定 `not found in this folder`）
   200|  - `resolveInFolder(folder: string, file: string): Promise<{ abs: string; rel: string; bytes: number; mtime: number }>`：`rel` 用 `/` 分隔、相对 `realpath(folder)`；`mtime` 是整数毫秒
  - `fileKind(abs: string): Promise<FileKind>`
  - `contentType(abs: string, kind: FileKind): string`
  - `parseRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined`：`undefined` = 没有 Range；`null` = 不合法 / 越界
  - `sendFile(req: IncomingMessage, res: ServerResponse, abs: string, size: number, headers: Record<string, string>): void`

- [ ] **Step 1: 写失败的测试**

`packages/cli/test/serve-files.test.ts`：

   210|```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { contentType, fileKind, NotInFolderError, parseRange, resolveInFolder } from "../dist/serve/files.js";

function folder() {
  const root = mkdtempSync(path.join(tmpdir(), "tah-files-"));
   220|  mkdirSync(path.join(root, "docs"));
  writeFileSync(path.join(root, "docs", "a.md"), "# hi");
  const outside = mkdtempSync(path.join(tmpdir(), "tah-files-out-"));
  writeFileSync(path.join(outside, "secret.txt"), "s");
  symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
  symlinkSync(path.join(root, "docs", "a.md"), path.join(root, "inside-link.md"));
  return { root, outside };
}

test("resolveInFolder: relative and absolute paths inside the folder", async () => {
   230|  const { root } = folder();
  const rel = await resolveInFolder(root, "docs/a.md");
  assert.equal(rel.rel, "docs/a.md");
  assert.equal(rel.bytes, 4);
  assert.ok(Number.isInteger(rel.mtime) && rel.mtime > 0);
  assert.equal((await resolveInFolder(root, path.join(root, "docs", "a.md"))).rel, "docs/a.md");
  assert.equal((await resolveInFolder(root, "./docs/../docs/a.md")).rel, "docs/a.md");
  assert.equal((await resolveInFolder(root, "inside-link.md")).rel, "docs/a.md");
});

   240|test("resolveInFolder: outside, symlinked out, directories and missing files are all not found", async () => {
  const { root, outside } = folder();
  const bad = [
    path.relative(root, path.join(outside, "secret.txt")),
    path.join(outside, "secret.txt"),
    "link.txt",
    "docs",
    "",
    "missing.txt",
  ];
   250|  for (const file of bad) {
    await assert.rejects(resolveInFolder(root, file), (err: unknown) => {
      assert.ok(err instanceof NotInFolderError, file);
      assert.equal((err as Error).message, "not found in this folder");
      return true;
    });
  }
});

test("fileKind: by extension, else by a NUL byte in the first 8KB", async () => {
   260|  const root = mkdtempSync(path.join(tmpdir(), "tah-kind-"));
  const file = (name: string, data: string | Buffer = "x") => {
    writeFileSync(path.join(root, name), data);
    return path.join(root, name);
  };
  assert.equal(await fileKind(file("a.PNG")), "image");
  assert.equal(await fileKind(file("a.svg")), "image");
  assert.equal(await fileKind(file("a.pdf")), "pdf");
  assert.equal(await fileKind(file("a.mov")), "video");
  assert.equal(await fileKind(file("a.htm")), "html");
   270|  assert.equal(await fileKind(file("a.markdown")), "markdown");
  assert.equal(await fileKind(file("a.ts", "export {}")), "text");
  assert.equal(await fileKind(file("Makefile", "all:\n")), "text");
  assert.equal(await fileKind(file("empty.dat", "")), "text");
  assert.equal(await fileKind(file("a.bin", Buffer.from([1, 0, 2]))), "binary");
  assert.equal(await fileKind(file("late-nul.txt", Buffer.concat([Buffer.alloc(9000, 65), Buffer.from([0])]))), "text");
});

test("contentType: known extensions, else text/plain or octet-stream by kind", () => {
  assert.equal(contentType("/x/a.md", "markdown"), "text/markdown; charset=utf-8");
   280|  assert.equal(contentType("/x/a.css", "text"), "text/css; charset=utf-8");
  assert.equal(contentType("/x/a.pdf", "pdf"), "application/pdf");
  assert.equal(contentType("/x/a.mov", "video"), "video/quicktime");
  assert.equal(contentType("/x/Makefile", "text"), "text/plain; charset=utf-8");
  assert.equal(contentType("/x/a.bin", "binary"), "application/octet-stream");
});

test("parseRange: one bytes= range; anything else is unsatisfiable", () => {
  assert.equal(parseRange(undefined, 10), undefined);
  assert.deepEqual(parseRange("bytes=2-5", 10), { start: 2, end: 5 });
   290|  assert.deepEqual(parseRange("bytes=8-", 10), { start: 8, end: 9 });
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange("bytes=-30", 10), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=0-99", 10), { start: 0, end: 9 });
  for (const bad of ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=-", "bytes=0-1,4-5", "items=0-1", "bytes=a-b"]) {
    assert.equal(parseRange(bad, 10), null, bad);
  }
  assert.equal(parseRange("bytes=0-", 0), null);
});
```
   300|
- [ ] **Step 2: 跑测试确认失败**

Run：`pnpm --filter @typescript-agent-harness/cli build; cd packages/cli && node --test --experimental-strip-types test/serve-files.test.ts`
Expected：FAIL（找不到 `../dist/serve/files.js`）。

- [ ] **Step 3: 实现**

`packages/cli/src/serve/protocol.ts` 末尾加上面 Interfaces 里的 `FileKind`。

   310|`packages/cli/src/serve/files.ts`：

```ts
import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { FileKind } from "./protocol.js";

/** Outside the open folder, missing, a directory or unreadable: callers answer all of them as 404. */
export class NotInFolderError extends Error {
   320|  constructor() {
    super("not found in this folder");
  }
}

/** `file` (relative to `folder`, or absolute) as a real file inside the real `folder`; symlinks may not lead out. */
export async function resolveInFolder(
  folder: string,
  file: string,
): Promise<{ abs: string; rel: string; bytes: number; mtime: number }> {
   330|  try {
    const root = await realpath(folder);
    const abs = await realpath(path.resolve(root, file));
    if (!abs.startsWith(root + path.sep)) throw new NotInFolderError();
    const info = await stat(abs);
    if (!info.isFile()) throw new NotInFolderError();
    return { abs, rel: path.relative(root, abs).split(path.sep).join("/"), bytes: info.size, mtime: Math.floor(info.mtimeMs) };
  } catch {
    throw new NotInFolderError();
  }
   340|}

const KINDS: Record<string, FileKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  ico: "image",
   350|  bmp: "image",
  pdf: "pdf",
  mp4: "video",
  webm: "video",
  mov: "video",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
};
   360|
const ext = (file: string) => path.extname(file).slice(1).toLowerCase();

/** By extension; anything else is text unless its first 8KB has a NUL byte. */
export async function fileKind(abs: string): Promise<FileKind> {
  const known = KINDS[ext(abs)];
  if (known) return known;
  const handle = await open(abs, "r");
  try {
    const buf = Buffer.alloc(8192);
   370|    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0) ? "binary" : "text";
  } finally {
    await handle.close();
  }
}

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
   380|  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
   390|  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  woff2: "font/woff2",
  woff: "font/woff",
   400|  ttf: "font/ttf",
};

export function contentType(abs: string, kind: FileKind): string {
  return TYPES[ext(abs)] ?? (kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream");
}

/** One `bytes=` range of a `size`-byte file: undefined = no header, null = malformed or out of bounds. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (header === undefined) return undefined;
   410|  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
   420|    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? null : { start, end };
}

/** Streams `abs` with `headers` plus nosniff / no-cache; honours one `Range`. */
export function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
   430|  abs: string,
  size: number,
  headers: Record<string, string>,
): void {
  const range = parseRange(req.headers.range, size);
  if (range === null) {
    res.writeHead(416, { "content-range": `bytes */${size}` }).end();
    return;
  }
  const common = {
   440|    ...headers,
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "cache-control": "no-cache",
  };
  if (range) {
    res.writeHead(206, {
      ...common,
      "content-length": String(range.end - range.start + 1),
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
   450|    });
  } else {
    res.writeHead(200, { ...common, "content-length": String(size) });
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(abs, range ?? {});
  stream.on("error", () => res.destroy());
   460|  stream.pipe(res);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/serve-files.test.ts`
Expected：PASS。

- [ ] **Step 5: 提交**

   470|按 code-commit 技能提交 `packages/cli/src/serve/files.ts`、`packages/cli/src/serve/protocol.ts`、`packages/cli/test/serve-files.test.ts`。参考信息：`feat(serve): 工作文件夹内的文件解析、类型判断与 Range 发送`。

---

### Task 3: 三个接口与预览令牌

**Files:**
- Modify: `packages/cli/src/serve/protocol.ts`（加 `FileStat`）
- Modify: `packages/cli/src/index.ts`（导出 `FileKind`、`FileStat`）
- Modify: `packages/cli/src/serve/http.ts`
   480|- Modify: `docs/design/serve.md`（接口表后、安全小节）
- Test: `packages/cli/test/serve.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `NotInFolderError`、`resolveInFolder`、`fileKind`、`contentType`、`sendFile`、`FileKind`；`createAttachmentStore(cwd).get(id)?.path`（`packages/cli/src/attachments/store.ts`）。
- Produces（`protocol.ts`）：

```ts
/** `GET /api/files/stat`: `path` is relative to the open folder (`/`-separated); `mtime` in ms; `previewURL` only for `html`. */
export type FileStat = { path: string; kind: FileKind; bytes: number; mtime: number; previewURL?: string };
   490|```

- Produces（HTTP）：
  - `GET /api/files/stat?path=<p>` 或 `?attachment=<id>` → 200 `FileStat`；没有两个参数 → 400 `{"error":"\"path\" or \"attachment\" is required"}`；找不到 → 404。
  - `GET /api/files/raw?path=<p>`（或 `attachment=<id>`，可带任意 `v=`）→ 文件字节；`Range` → 206 / 416。
  - `GET|HEAD /preview/<预览令牌>/<相对路径>` → 文件字节，CSP `sandbox allow-scripts allow-forms allow-popups allow-modals`；不需要登录；令牌不对 → 404。
  - `previewURL` 格式：`/preview/<令牌>/<rel 的每一段 encodeURIComponent 后用 / 连接>`（不带 `?v=`，网页自己加）。

- [ ] **Step 1: 写失败的测试**

   500|`packages/cli/test/serve.test.ts` 末尾追加（文件顶部已 import `mkdirSync`、`mkdtempSync`、`symlinkSync`、`writeFileSync`、`createAttachmentStore`、`raw`、`client`、`fakeServer`）：

```ts
const q = (p: string) => encodeURIComponent(p);

test("files: stat and raw read inside the open folder only", async () => {
  const s = await fakeServer();
  try {
    mkdirSync(path.join(s.cwd, "docs"));
    writeFileSync(path.join(s.cwd, "docs", "a.md"), "# hi");
   510|    writeFileSync(path.join(s.cwd, "data.bin"), Buffer.from([1, 0, 2]));
    writeFileSync(path.join(s.cwd, "notes"), "plain");
    writeFileSync(path.join(s.cwd, "doc.pdf"), "%PDF-1.4");
    const outside = mkdtempSync(path.join(tmpdir(), "tah-serve-out-"));
    writeFileSync(path.join(outside, "secret.txt"), "s");
    symlinkSync(path.join(outside, "secret.txt"), path.join(s.cwd, "link.txt"));
    const anon = client(s.base);
    const api = client(s.base, s.cookie);

    assert.equal((await anon.get(`/api/files/stat?path=${q("docs/a.md")}`)).status, 401);
   520|    assert.equal((await anon.get(`/api/files/raw?path=${q("docs/a.md")}`)).status, 401);

    const md = await api.get(`/api/files/stat?path=${q("docs/a.md")}`);
    assert.equal(md.status, 200);
    const view = JSON.parse(md.body);
    assert.equal(view.path, "docs/a.md");
    assert.equal(view.kind, "markdown");
    assert.equal(view.bytes, 4);
    assert.ok(Number.isInteger(view.mtime));
    assert.equal("previewURL" in view, false);
   530|    assert.equal(JSON.parse((await api.get(`/api/files/stat?path=${q(path.join(s.cwd, "docs", "a.md"))}`)).body).path, "docs/a.md");
    assert.equal(JSON.parse((await api.get("/api/files/stat?path=data.bin")).body).kind, "binary");
    assert.equal(JSON.parse((await api.get("/api/files/stat?path=notes")).body).kind, "text");

    for (const bad of [path.relative(s.cwd, path.join(outside, "secret.txt")), path.join(outside, "secret.txt"), "link.txt", "docs", "missing.txt"]) {
      const r = await api.get(`/api/files/stat?path=${q(bad)}`);
      assert.equal(r.status, 404, bad);
      assert.deepEqual(JSON.parse(r.body), { error: "not found in this folder" });
      assert.equal((await api.get(`/api/files/raw?path=${q(bad)}`)).status, 404, bad);
    }
   540|    assert.equal((await api.get("/api/files/stat")).status, 400);

    const body = await api.get(`/api/files/raw?path=${q("docs/a.md")}&v=${view.mtime}`);
    assert.equal(body.status, 200);
    assert.equal(body.body, "# hi");
    assert.equal(body.headers["content-type"], "text/markdown; charset=utf-8");
    assert.equal(body.headers["x-content-type-options"], "nosniff");
    assert.equal(body.headers["content-security-policy"], "sandbox");
    assert.equal(body.headers["cache-control"], "no-cache");
    const pdf = await api.get("/api/files/raw?path=doc.pdf");
   550|    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.equal(pdf.headers["content-security-policy"], undefined);
  } finally {
    await s.close();
  }
});

test("files: raw honours one Range", async () => {
  const s = await fakeServer();
  try {
   560|    writeFileSync(path.join(s.cwd, "v.mp4"), "0123456789");
    const get = (range: string) =>
      raw(s.base, "GET", "/api/files/raw?path=v.mp4", { headers: { cookie: s.cookie, range } });
    const part = await get("bytes=2-5");
    assert.equal(part.status, 206);
    assert.equal(part.body, "2345");
    assert.equal(part.headers["content-range"], "bytes 2-5/10");
    assert.equal(part.headers["accept-ranges"], "bytes");
    assert.equal((await get("bytes=-3")).body, "789");
    assert.equal((await get("bytes=8-")).body, "89");
   570|    assert.equal((await get("bytes=20-")).status, 416);
    assert.equal((await get("bytes=0-1,4-5")).status, 416);
  } finally {
    await s.close();
  }
});

test("files: attachments by id; unknown or malformed ids are not found", async () => {
  const s = await fakeServer();
  try {
   580|    const ref = createAttachmentStore(s.cwd).save({ name: "shot.png", mime: "image/png", data: Buffer.from("png") });
    const api = client(s.base, s.cookie);
    const view = JSON.parse((await api.get(`/api/files/stat?attachment=${ref.id}`)).body);
    assert.equal(view.kind, "image");
    assert.equal(view.path, `.tah/attachments/objects/${ref.sha256}/shot.png`);
    assert.equal((await api.get(`/api/files/raw?attachment=${ref.id}`)).body, "png");
    assert.equal((await api.get("/api/files/stat?attachment=nope")).status, 404);
    assert.equal((await api.get(`/api/files/stat?attachment=${q("../../x")}`)).status, 404);
  } finally {
    await s.close();
   590|  }
});

test("preview: html and its folder files under a preview token, sandboxed, without the sign-in cookie", async () => {
  const s = await fakeServer();
  try {
    mkdirSync(path.join(s.cwd, "site"));
    writeFileSync(path.join(s.cwd, "site", "index.html"), '<link rel="stylesheet" href="style.css"><p>hi</p>');
    writeFileSync(path.join(s.cwd, "site", "style.css"), "p{color:red}");
    const outside = mkdtempSync(path.join(tmpdir(), "tah-serve-out-"));
   600|    writeFileSync(path.join(outside, "secret.txt"), "s");
    symlinkSync(path.join(outside, "secret.txt"), path.join(s.cwd, "site", "link.txt"));
    const api = client(s.base, s.cookie);
    const anon = client(s.base);

    const view = JSON.parse((await api.get("/api/files/stat?path=site/index.html")).body);
    assert.equal(view.kind, "html");
    assert.match(view.previewURL, /^\/preview\/[\w-]{43}\/site\/index\.html$/);

    const page = await anon.get(view.previewURL);
   610|    assert.equal(page.status, 200);
    assert.match(page.body, /<p>hi<\/p>/);
    assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(page.headers["content-security-policy"], "sandbox allow-scripts allow-forms allow-popups allow-modals");
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    const css = await anon.get(view.previewURL.replace("index.html", "style.css"));
    assert.equal(css.status, 200);
    assert.equal(css.headers["content-type"], "text/css; charset=utf-8");

    assert.equal((await anon.get(view.previewURL.replace("index.html", "link.txt"))).status, 404);
   620|    assert.equal((await anon.get(view.previewURL.replace(/^\/preview\/[^/]+/, `/preview/${"x".repeat(43)}`))).status, 404);
    assert.equal((await anon.get(view.previewURL.replace(/^\/preview\/[^/]+/, "/preview/short"))).status, 404);
    assert.equal((await raw(s.base, "POST", view.previewURL)).status, 405);
  } finally {
    await s.close();
  }
});

test("files: after switching folders only the new folder is readable", async () => {
  const s = await fakeServer();
   630|  try {
    writeFileSync(path.join(s.cwd, "old.txt"), "old");
    const other = mkdtempSync(path.join(tmpdir(), "tah-serve-other-"));
    writeFileSync(path.join(other, "new.txt"), "new");
    const api = client(s.base, s.cookie);
    assert.equal((await api.post("/api/workspaces/add", { path: other })).status, 204);
    assert.equal((await api.post("/api/reset", { cwd: other })).status, 204);
    assert.equal((await api.get("/api/files/stat?path=old.txt")).status, 404);
    assert.equal((await api.get("/api/files/stat?path=new.txt")).status, 200);
  } finally {
   640|    await s.close();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/serve.test.ts`
Expected：新增的 5 个测试 FAIL（404 `no such endpoint` / 静态页 404），原有测试 PASS。

- [ ] **Step 3: 实现**
   650|
1. `protocol.ts`：在 `FileKind` 后加 Interfaces 里的 `FileStat`。

2. `index.ts`：`./serve/protocol.js` 的 `export type { … }` 列表里按字母序加 `FileKind`、`FileStat`。

3. `http.ts`：

   - import：`import { randomBytes, timingSafeEqual } from "node:crypto";`；`createAttachmentStore` 加进 `../attachments/store.js` 的 import；新增 `import { contentType, fileKind, NotInFolderError, resolveInFolder, sendFile } from "./files.js";`；`FileStat` 加进 `./protocol.js` 的 type import。
   - 常量（放在 `CSP` 下面）：

   660|```ts
/** Agent-made pages run as an opaque origin: no sign-in cookie, no `/api`. */
const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals";
```

   - `createServeHandler` 里，`let choosing = false;` 后面：

```ts
  const previewToken = randomBytes(32).toString("base64url");

   670|  /** The file a `/api/files/*` query names (`path=` or `attachment=<id>`), inside the open folder. */
  const fileOf = async (req: IncomingMessage) => {
    const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
    const id = query.get("attachment");
    if (id !== null) {
      const ref = /^[\w-]+$/.test(id) ? createAttachmentStore(workspaces.cwd).get(id) : undefined;
      if (!ref) throw new NotInFolderError();
      return resolveInFolder(workspaces.cwd, ref.path);
    }
    const file = query.get("path");
   680|    if (!file) throw new HttpError(400, '"path" or "attachment" is required');
    return resolveInFolder(workspaces.cwd, file);
  };
```

   - `api` 的 `switch` 里（放在 `GET /api/fs` 前）：

```ts
      case "GET /api/files/stat": {
        const file = await fileOf(req);
   690|        const kind = await fileKind(file.abs);
        const view: FileStat = { path: file.rel, kind, bytes: file.bytes, mtime: file.mtime };
        if (kind === "html") view.previewURL = `/preview/${previewToken}/${file.rel.split("/").map(encodeURIComponent).join("/")}`;
        return json(res, 200, view);
      }
      case "GET /api/files/raw": {
        const file = await fileOf(req);
        const kind = await fileKind(file.abs);
        return sendFile(req, res, file.abs, file.bytes, {
          "content-type": contentType(file.abs, kind),
   700|          ...(kind === "pdf" ? {} : { "content-security-policy": "sandbox" }),
        });
      }
```

   - `page` 函数前加：

```ts
  const preview = async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed");
    const [, , token = "", ...rest] = pathname.split("/");
   710|    if (!sameToken(token, previewToken)) throw new NotInFolderError();
    const file = await resolveInFolder(workspaces.cwd, rest.join("/"));
    const kind = await fileKind(file.abs);
    sendFile(req, res, file.abs, file.bytes, {
      "content-type": contentType(file.abs, kind),
      "content-security-policy": PREVIEW_CSP,
    });
  };
```

   720|   - `handle` 里路由改为：

```ts
        : pathname.startsWith("/api/")
          ? api(req, res, pathname)
          : pathname.startsWith("/preview/")
            ? preview(req, res, pathname)
            : page(req, res, pathname);
```

   - `work.catch` 里，`HttpError` 那行之后加：
   730|
```ts
      if (err instanceof NotInFolderError) return json(res, 404, { error: err.message });
```

4. `docs/design/serve.md`：「Skills（v0.30.1）」那一段之后加一段：

```markdown
文件预览（v0.35）：`GET /api/files/stat?path=…`（或 `?attachment=<id>`）返回 `FileStat`；`GET /api/files/raw` 返回文件字节（支持 `Range`）；`GET /preview/<预览令牌>/<相对路径>` 给 HTML 预览用（不需要登录，CSP sandbox）。都只读、只限当前工作文件夹，见 [文件预览](./file-preview.md)。
```

   740|「安全」小节末尾加一条：

```markdown
- 文件预览接口只读、只限当前工作文件夹（`realpath` 后比较，软链接不能指向外面）；HTML 预览在 sandbox 不透明来源里运行，拿不到登录 cookie、调不了 `/api`，但能用预览令牌读这个文件夹里的文件。只预览信任的 HTML。
```

- [ ] **Step 4: 跑测试确认通过**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/serve.test.ts test/serve-files.test.ts test/serve-workspaces.test.ts`
Expected：PASS。
   750|
- [ ] **Step 5: 提交**

按 code-commit 技能提交 `packages/cli/src/serve/http.ts`、`packages/cli/src/serve/protocol.ts`、`packages/cli/src/index.ts`、`packages/cli/test/serve.test.ts`、`docs/design/serve.md`。参考信息：`feat(serve): 文件预览接口与 HTML 沙箱预览`。

---

### Task 4: 网页的纯函数、状态和 API

**Files:**
   760|- Create: `packages/web/src/preview-view.ts`
- Modify: `packages/web/src/state.ts`
- Modify: `packages/web/src/api.ts`
- Test: `packages/web/test/preview-view.test.ts`、`packages/web/test/state.test.ts`

**Interfaces:**
- Consumes：`HostEvent`（带 Task 1 的 `path`）、`FileStat`（Task 3，从 `@typescript-agent-harness/cli` import type）。
- Produces（`preview-view.ts`）：
  - `type FileTarget = { path: string } | { attachment: string }`
  - `fileQuery(target: FileTarget): string`（`path=…` / `attachment=…`，已编码）
   770|  - `codePath(code: string): string | null`
  - `linkPath(href: string | undefined): string | null`
  - `relativeTo(file: string, src: string): string | null`
  - `codeBlock(text: string, file: string): string`
  - `touchesFiles(event: HostEvent): boolean`
- Produces（`state.ts`）：`Entry` 的 tool 分支加 `path?: string`。
- Produces（`api.ts`）：`api.fileStat(target: FileTarget): Promise<FileStat>`；`api.fileText(target: FileTarget, mtime: number, limit: number): Promise<string>`；`export function fileRawURL(target: FileTarget, mtime: number): string`。

- [ ] **Step 1: 写失败的测试**

   780|`packages/web/test/preview-view.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { codeBlock, codePath, fileQuery, linkPath, relativeTo, touchesFiles } from "../src/preview-view.ts";

test("inline code that looks like a file path", () => {
  for (const [code, file] of [
    ["src/app.ts", "src/app.ts"],
    ["README.md", "README.md"],
   790|    ["./docs/a.md", "./docs/a.md"],
    ["/Users/me/x/report.html", "/Users/me/x/report.html"],
    ["src/app.ts:12", "src/app.ts"],
    ["src/app.ts:12:5", "src/app.ts"],
    ["package.json", "package.json"],
    ["docs/", "docs/"],
  ] as const) {
    assert.equal(codePath(code), file, code);
  }
  for (const code of ["npm test", "foo.bar()", "useState", "1.5", "a = b", "https://x.dev/a.md", "C:", "'a.md'", "", "x\ny.md", "v0.35"]) {
   800|    assert.equal(codePath(code), null, code);
  }
});

test("markdown links to files; web, mail and anchors are not", () => {
  assert.equal(linkPath("docs/a.md"), "docs/a.md");
  assert.equal(linkPath("docs/my%20notes.md"), "docs/my notes.md");
  assert.equal(linkPath("src/app.ts:30"), "src/app.ts");
  assert.equal(linkPath("src/app.ts#L30"), "src/app.ts");
  assert.equal(linkPath("/abs/report.html"), "/abs/report.html");
   810|  for (const href of [undefined, "", "#top", "https://x.dev", "mailto:a@b.c", "//cdn.x/a.js", "file:///a.md"]) {
    assert.equal(linkPath(href), null, String(href));
  }
});

test("relative addresses inside a previewed file resolve against its folder", () => {
  assert.equal(relativeTo("docs/guide/a.md", "img/x.png"), "docs/guide/img/x.png");
  assert.equal(relativeTo("docs/guide/a.md", "./x.png"), "docs/guide/x.png");
  assert.equal(relativeTo("docs/guide/a.md", "../x.png?raw=1"), "docs/x.png");
  assert.equal(relativeTo("a.md", "b.md#part"), "b.md");
   820|  assert.equal(relativeTo("a.md", "/abs/x.png"), "/abs/x.png");
  assert.equal(relativeTo("a.md", "../outside.png"), null);
  for (const src of ["", "https://x.dev/a.png", "data:image/png;base64,AA", "//cdn.x/a.png", "#top"]) {
    assert.equal(relativeTo("a.md", src), null, src);
  }
});

test("code blocks use a fence longer than any backtick run and the extension as language", () => {
  assert.equal(codeBlock("let a = 1", "src/a.ts"), "```ts\nlet a = 1\n```");
  assert.equal(codeBlock("x ``` y", "notes"), "````\nx ``` y\n````");
   830|  assert.equal(codeBlock("a", "weird.c++"), "```\na\n```");
});

test("only finished writes, edits and commands can change files", () => {
  const end = (tool: string) => ({ type: "tool.end" as const, callId: "c", tool, summary: "", ok: true, result: "" });
  assert.equal(touchesFiles(end("write_file")), true);
  assert.equal(touchesFiles(end("edit_file")), true);
  assert.equal(touchesFiles(end("execute_command")), true);
  assert.equal(touchesFiles(end("read_file")), false);
  assert.equal(touchesFiles({ type: "tool.start", callId: "c", tool: "write_file", summary: "" }), false);
   840|  assert.equal(touchesFiles({ type: "text", delta: "x" }), false);
});

test("file queries are encoded", () => {
  assert.equal(fileQuery({ path: "docs/my notes.md" }), "path=docs%2Fmy%20notes.md");
  assert.equal(fileQuery({ attachment: "abc_-1" }), "attachment=abc_-1");
});
```

`packages/web/test/state.test.ts` 末尾追加：
   850|
```ts
test("tool entries keep the file path from events and history", () => {
  const live = run([
    session("s1"),
    { type: "tool.start", callId: "c1", tool: "write_file", summary: "a.md", path: "docs/a.md" },
    { type: "tool.end", callId: "c1", tool: "write_file", summary: "a.md", ok: true, result: "written", path: "docs/a.md" },
    { type: "tool.end", callId: "c2", tool: "edit_file", summary: "b.md", ok: false, result: "rejected", path: "b.md" },
  ]);
  const tools = live.entries.filter((e) => e.kind === "tool");
  assert.deepEqual(
   860|    tools.map((e) => (e.kind === "tool" ? e.path : undefined)),
    ["docs/a.md", "b.md"],
  );
  const resumed = run([
    session("s2", [{ role: "tool", callId: "c1", tool: "read_file", summary: "a.md", ok: true, result: "2 lines", path: "a.md" }]),
  ]);
  const entry = resumed.entries[0];
  assert.equal(entry?.kind === "tool" ? entry.path : undefined, "a.md");
});
```
   870|
- [ ] **Step 2: 跑测试确认失败**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/web && node --test --experimental-strip-types test/*.test.ts`
Expected：FAIL（找不到 `../src/preview-view.ts`；state 测试 `path` 为 undefined）。

- [ ] **Step 3: 实现**

`packages/web/src/preview-view.ts`：

   880|```ts
import type { HostEvent } from "@typescript-agent-harness/cli";

/** A file the preview panel can open: a path in the open folder, or an uploaded attachment. */
export type FileTarget = { path: string } | { attachment: string };

export function fileQuery(target: FileTarget): string {
  return "attachment" in target
    ? `attachment=${encodeURIComponent(target.attachment)}`
    : `path=${encodeURIComponent(target.path)}`;
   890|}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|pdf|mp4|webm|mov|html?|md|markdown|mdx|tsx?|jsx?|mjs|cjs|json|jsonc|css|scss|less|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|ya?ml|toml|ini|conf|txt|log|csv|tsv|xml|sql|vue|svelte|lock)$/i;

/** `src/a.ts:12` / `src/a.ts:12:5` → `src/a.ts`. */
const withoutLine = (p: string) => p.replace(/(:\d+){1,2}$/, "");

/** Inline code that names a file: no spaces, brackets or quotes, not a URL, and has a `/` or a known extension. */
   900|export function codePath(code: string): string | null {
  const text = withoutLine(code.trim());
  if (!text || /[\s()[\]{}<>"'`,;]/.test(text) || SCHEME.test(text)) return null;
  return text.includes("/") || EXT.test(text) ? text : null;
}

/** A Markdown link target that names a file; web, mail, `file:` and `#` links do not. */
export function linkPath(href: string | undefined): string | null {
  if (!href || href.startsWith("#") || href.startsWith("//") || SCHEME.test(href)) return null;
  let file = href.replace(/[?#].*$/, "");
   910|  try {
    file = decodeURI(file);
  } catch {}
  return withoutLine(file) || null;
}

/** `src` inside the previewed file `file` (folder-relative), as a folder-relative path; null for web / data / anchors or above the folder. */
export function relativeTo(file: string, src: string): string | null {
  if (!src || src.startsWith("#") || src.startsWith("//") || SCHEME.test(src)) return null;
  const clean = src.replace(/[?#].*$/, "");
   920|  if (clean.startsWith("/")) return clean;
  const parts = file.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (seg && seg !== ".") {
      parts.push(seg);
    }
  }
   930|  return parts.join("/") || null;
}

/** A fenced block for highlighting `text`, fenced longer than any backtick run in it. */
export function codeBlock(text: string, file: string): string {
  let longest = 2;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = "`".repeat(longest + 1);
  const dot = file.lastIndexOf(".");
  const lang = dot > file.lastIndexOf("/") ? file.slice(dot + 1).toLowerCase() : "";
   940|  return `${fence}${/^[a-z\d]+$/.test(lang) ? lang : ""}\n${text}\n${fence}`;
}

const WRITERS = new Set(["write_file", "edit_file", "execute_command"]);

/** A finished tool that may have changed files: the open preview checks its file again. */
export function touchesFiles(event: HostEvent): boolean {
  return event.type === "tool.end" && WRITERS.has(event.tool);
}
```
   950|
注意：`codeBlock("a", "weird.c++")` 的语言 `c++` 不匹配 `/^[a-z\d]+$/`，所以不带语言。`codePath("v0.35")` 返回 null（`.35` 不在扩展名表里，也没有 `/`）。`codePath("C:")` 返回 null（`SCHEME`）。

`packages/web/src/state.ts`：

- `Entry` 的 tool 分支：`{ id: number; kind: "tool"; callId: string; tool: string; summary: string; status: "running" | "ok" | "failed"; result: string; path?: string }`
- `fromHistory` 的 tool 分支：返回对象末尾加 `...(h.path ? { path: h.path } : {})`
- `tool.start`：push 的对象末尾加 `...(action.path ? { path: action.path } : {})`
- `tool.end` 找不到对应条目时 push 的对象末尾同样加 `...(action.path ? { path: action.path } : {})`（找到时保留原条目的 `path`，不用改）
   960|
`packages/web/src/api.ts`：

- import 里加 `FileStat`（type）和 `import { fileQuery, type FileTarget } from "./preview-view";`
- `api` 对象之前加：

```ts
/** Address of a file's bytes; `v` changes with the file, so the browser never shows a stale copy. */
export function fileRawURL(target: FileTarget, mtime: number): string {
  return `/api/files/raw?${fileQuery(target)}&v=${mtime}`;
}
   970|```

- `api` 对象里（`skills` 前）加：

```ts
  fileStat: async (target: FileTarget) =>
    (await (await call("GET", `/api/files/stat?${fileQuery(target)}`)).json()) as FileStat,
  /** The first `limit` bytes as text. */
  async fileText(target: FileTarget, mtime: number, limit: number): Promise<string> {
    const res = await fetch(fileRawURL(target, mtime), { headers: { range: `bytes=0-${limit - 1}` } });
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
   980|    return res.text();
  },
```

- [ ] **Step 4: 跑测试确认通过**

Run：`cd packages/web && node --test --experimental-strip-types test/*.test.ts && pnpm --filter @typescript-agent-harness/web typecheck`
Expected：PASS，typecheck 无错。

- [ ] **Step 5: 提交**
   990|
按 code-commit 技能提交 `packages/web/src/preview-view.ts`、`packages/web/src/state.ts`、`packages/web/src/api.ts`、`packages/web/test/preview-view.test.ts`、`packages/web/test/state.test.ts`。参考信息：`feat(web): 文件路径识别、预览请求与工具条目路径`。

---

### Task 5: 预览面板与可点的路径

**Files:**
- Create: `packages/web/src/components/FilePreview.tsx`
- Modify: `packages/web/src/components/Messages.tsx`
  1000|- Modify: `packages/web/src/components/ToolLine.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/styles.css`

**Interfaces:**
- Consumes：Task 4 的 `FileTarget`、`codePath`、`linkPath`、`relativeTo`、`codeBlock`、`touchesFiles`、`api.fileStat`、`api.fileText`、`fileRawURL`；`ApiError`；`FileStat`。
- Produces：`FilePreview(props: { target: FileTarget; version: number; onOpen(target: FileTarget): void; onClose(): void })`；`Messages` 多一个必填 prop `onOpen(target: FileTarget): void`；`ToolLine` 多两个可选 prop `path?: string`、`onOpen?(target: FileTarget): void`。

这一任务没有单元测试（组件；逻辑都在 Task 4 的纯函数里）。验证靠 typecheck、build 和 Step 4 的浏览器冒烟。
  1010|
- [ ] **Step 1: `ToolLine.tsx`**

整个文件替换为：

```tsx
import type { FileTarget } from "../preview-view";

export function ToolLine(props: {
  tool: string;
  summary: string;
  1020|  status: "running" | "ok" | "failed";
  result: string;
  path?: string;
  onOpen?(target: FileTarget): void;
}) {
  const { path, onOpen } = props;
  return (
    <div className={`tool ${props.status}`}>
      <span className="dot">⏺</span>
      <span className="name">{props.tool}</span>
  1030|      {props.summary && path && onOpen ? (
        <button type="button" className="summary file-link" title={path} onClick={() => onOpen({ path })}>
          {props.summary}
        </button>
      ) : props.summary ? (
        <span className="summary">{props.summary}</span>
      ) : null}
      {props.status === "running" ? <span className="spinner" aria-label="running" /> : null}
      {props.status === "ok" ? <span className="result">✓ {props.result}</span> : null}
      {props.status === "failed" ? <span className="result">✗ {props.result}</span> : null}
  1040|    </div>
  );
}
```

- [ ] **Step 2: `Messages.tsx`**

1. import：`import Markdown, { type Components } from "react-markdown";`；`import { codePath, linkPath, type FileTarget } from "../preview-view";`。
2. `Reply` 改为（仍然不渲染原始 HTML）：

  1050|```tsx
type Open = (target: FileTarget) => void;

/** Paths in a reply open in the preview panel; other links and code stay as they are. */
function fileLinks(onOpen: Open): Components {
  return {
    a({ node: _node, href, children, ...rest }) {
      const file = linkPath(href);
      if (!file) return <a href={href} {...rest}>{children}</a>;
      return (
  1060|        <a
          href={href}
          className="file-link"
          onClick={(e) => {
            e.preventDefault();
            onOpen({ path: file });
          }}
        >
          {children}
        </a>
  1070|      );
    },
    code({ node: _node, children, ...rest }) {
      const file = typeof children === "string" ? codePath(children) : null;
      if (!file) return <code {...rest}>{children}</code>;
      return (
        <code
          {...rest}
          className="file-link"
          role="button"
  1080|          tabIndex={0}
          title={`Open ${file}`}
          onClick={() => onOpen({ path: file })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onOpen({ path: file });
          }}
        >
          {children}
        </code>
      );
  1090|    },
  };
}

/** No raw HTML: replies can echo file contents, and this page can approve commands. */
const Reply = memo(function Reply({ text, onOpen }: { text: string; onOpen: Open }) {
  const components = useMemo(() => fileLinks(onOpen), [onOpen]);
  return (
    <div className="reply">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
  1100|        {text}
      </Markdown>
    </div>
  );
});
```

（`useMemo` 加进 `react` 的 import。代码块的 `code` 子节点被高亮成数组，或含换行，所以 `codePath` 只会命中行内代码。）

3. `Row` 接收 `onOpen`：`const Row = memo(function Row({ entry, onOpen }: { entry: Entry; onOpen: Open }) {`
  1110|   - 附件：把 `<span key={a.id} className={`user-attach-chip ${a.kind}`}>` 换成

```tsx
                <button
                  type="button"
                  key={a.id}
                  className={`user-attach-chip ${a.kind} file-link`}
                  onClick={() => onOpen({ attachment: a.id })}
                >
                  {a.kind === "image" ? "img" : "file"} · {a.name} · {formatSize(a.bytes)}
  1120|                </button>
```

   - `case "assistant": return <Reply text={entry.text} onOpen={onOpen} />;`
   - `case "tool":` 给 `ToolLine` 加 `{...(entry.path ? { path: entry.path } : {})} onOpen={onOpen}`。

4. `Steps` 接收并下传 `onOpen`：签名 `function Steps({ entries, live, onOpen }: { entries: Entry[]; live: boolean; onOpen: Open })`，两处 `<Row key={e.id} entry={e} />` 改为 `<Row key={e.id} entry={e} onOpen={onOpen} />`。

5. `Messages` 签名加 `onOpen: Open`，`<Row … />`、`<Steps … />` 都传 `onOpen={onOpen}`。

- [ ] **Step 3: `FilePreview.tsx`**
  1130|
```tsx
import type { FileStat } from "@typescript-agent-harness/cli";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { api, ApiError, fileRawURL } from "../api";
import { codeBlock, fileQuery, relativeTo, type FileTarget } from "../preview-view";

const WIDTH = "tah.previewWidth";
  1140|const TEXT_LIMIT = 1024 * 1024;
const HIGHLIGHT_LIMIT = 256 * 1024;
/** Same as the server's `/preview` CSP; never add allow-same-origin (the page could then use the sign-in cookie). */
const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
  1150|
const textual = (stat: FileStat, source: boolean) =>
  stat.kind === "markdown" || stat.kind === "text" || (stat.kind === "html" && source);

/** Read-only preview of one file in the open folder; `version` bumps when a tool may have changed files. */
export function FilePreview(props: {
  target: FileTarget;
  version: number;
  onOpen(target: FileTarget): void;
  onClose(): void;
  1160|}) {
  const { target, version, onOpen, onClose } = props;
  const key = fileQuery(target);
  const [stat, setStat] = useState<FileStat>();
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const [source, setSource] = useState(false);
  const [text, setText] = useState<string>();
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH)) || 480);
  1170|  const drag = useRef<{ x: number; width: number } | undefined>(undefined);

  useEffect(() => {
    setStat(undefined);
    setGone(false);
    setFailed(undefined);
    setSource(false);
  }, [key]);

  useEffect(() => {
  1180|    let live = true;
    api.fileStat(target).then(
      (next) => {
        if (!live) return;
        setGone(false);
        setFailed(undefined);
        setStat((prev) => (prev && prev.path === next.path && prev.mtime === next.mtime ? prev : next));
      },
      (err: unknown) => {
        if (!live) return;
  1190|        if (err instanceof ApiError && err.status === 404) setGone(true);
        else setFailed(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      live = false;
    };
    // `target` is identified by `key`.
  }, [key, version, nonce]);

  1200|  const wantsText = stat ? textual(stat, source) : false;
  useEffect(() => {
    setText(undefined);
    if (!stat || !wantsText) return;
    if (stat.bytes === 0) {
      setText("");
      return;
    }
    let live = true;
    api.fileText(target, stat.mtime, TEXT_LIMIT).then(
      (body) => live && setText(body),
      (err: unknown) => live && setFailed(err instanceof Error ? err.message : String(err)),
    );
  1210|    return () => {
      live = false;
    };
  }, [stat, wantsText, nonce]);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
  1220|    if (!drag.current) return;
    const next = Math.min(Math.max(drag.current.width + drag.current.x - e.clientX, 280), window.innerWidth - 360);
    setWidth(next);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = undefined;
    localStorage.setItem(WIDTH, String(width));
  };

  1230|  const title = stat?.path ?? ("path" in target ? target.path : "attachment");
  return (
    <aside className="preview" style={{ width }}>
      <div className="preview-resize" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} />
      <div className="preview-head">
        <span className="preview-title" title={title}>
          {title}
        </span>
        {stat?.kind === "html" ? (
          <button type="button" onClick={() => setSource(!source)}>
  1240|            {source ? "Rendered" : "Source"}
          </button>
        ) : null}
        <button type="button" onClick={() => setNonce(nonce + 1)} aria-label="Refresh">
          ↻
        </button>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
  1250|      <div className="preview-body">
        {gone ? (
          <div className="preview-empty">{stat ? "This file was deleted" : "Not found in this folder"}</div>
        ) : failed ? (
          <div className="preview-empty">Could not load: {failed}</div>
        ) : !stat ? (
          <div className="preview-empty">
            <span className="spinner" />
          </div>
        ) : (
  1260|          <Body key={nonce} stat={stat} target={target} source={source} text={text} onOpen={onOpen} />
        )}
      </div>
    </aside>
  );
}

function Body(props: { stat: FileStat; target: FileTarget; source: boolean; text: string | undefined; onOpen(target: FileTarget): void }) {
  const { stat, target, source, text, onOpen } = props;
  const raw = fileRawURL(target, stat.mtime);
  1270|  if (stat.kind === "image") return <img className="preview-image" src={raw} alt={stat.path} />;
  if (stat.kind === "pdf") return <iframe className="preview-frame" src={raw} title={stat.path} />;
  if (stat.kind === "video") return <video className="preview-video" src={raw} controls />;
  if (stat.kind === "html" && !source && stat.previewURL) {
    return <iframe className="preview-frame" src={`${stat.previewURL}?v=${stat.mtime}`} sandbox={SANDBOX} title={stat.path} />;
  }
  if (stat.kind === "binary") return <div className="preview-empty">No preview for this file · {formatSize(stat.bytes)}</div>;
  if (text === undefined) {
    return (
      <div className="preview-empty">
  1280|        <span className="spinner" />
      </div>
    );
  }
  const cut = stat.bytes > TEXT_LIMIT ? <div className="preview-note">File too large — showing the first 1 MB</div> : null;
  if (stat.kind === "markdown" && !source) {
    return (
      <div className="reply preview-markdown">
        {cut}
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={inFile(stat, onOpen)}>
  1290|          {text}
        </Markdown>
      </div>
    );
  }
  if (text.length > HIGHLIGHT_LIMIT) {
    return (
      <>
        {cut}
        <pre className="preview-text">{text}</pre>
  1300|      </>
    );
  }
  return (
    <div className="reply preview-code">
      {cut}
      <Markdown rehypePlugins={[rehypeHighlight]}>{codeBlock(text, stat.path)}</Markdown>
    </div>
  );
}
  1310|
/** Inside a previewed Markdown file: relative images load from the folder, relative links open here, web links in a new tab. */
function inFile(stat: FileStat, onOpen: (target: FileTarget) => void): Components {
  return {
    img({ node: _node, src, alt }) {
      const file = typeof src === "string" ? relativeTo(stat.path, src) : null;
      return <img src={file ? fileRawURL({ path: file }, stat.mtime) : src} alt={alt ?? ""} />;
    },
    a({ node: _node, href, children }) {
      const file = href ? relativeTo(stat.path, href) : null;
  1320|      if (file) {
        return (
          <a
            href={href}
            className="file-link"
            onClick={(e) => {
              e.preventDefault();
              onOpen({ path: file });
            }}
          >
  1330|            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
  1340|  };
}
```

说明：
- 「源码」只在 HTML 上出现；Markdown 不提供源码切换（`textual` 里 `markdown` 总是取文本；`Body` 里 `source` 只对 HTML 生效）。
- `Body` 用 `key={nonce}`：点刷新时整个内容重新挂载，图片、PDF、视频、iframe 都会重新请求（地址里的 `v=<mtime>` 没变也一样）。

- [ ] **Step 4: `App.tsx`、`styles.css`**

`App.tsx`：
  1350|
1. import：`import { FilePreview } from "./components/FilePreview";`、`import { touchesFiles, type FileTarget } from "./preview-view";`。
2. state（`settings` 之后）：

```tsx
  const [preview, setPreview] = useState<FileTarget>();
  const [previewVersion, setPreviewVersion] = useState(0);
  const closePreview = useCallback(() => setPreview(undefined), []);
```

  1360|3. `connect` 的 `onEvent: enqueue,` 改为：

```tsx
        onEvent(event) {
          enqueue(event);
          if (touchesFiles(event)) setPreviewVersion((v) => v + 1);
        },
```

4. 切换会话（含切换文件夹）时关闭面板，加在 `refresh` 的 `useEffect` 之后：

  1370|```tsx
  useEffect(() => setPreview(undefined), [state.sessionId]);
```

5. `<Messages entries={state.entries} busy={state.busy}>` 改为 `<Messages entries={state.entries} busy={state.busy} onOpen={setPreview}>`。
6. `</main>` 之后（`.app` 里，和 `main` 并排）：

```tsx
      {preview ? (
        <FilePreview target={preview} version={previewVersion} onOpen={setPreview} onClose={closePreview} />
  1380|      ) : null}
```

`styles.css` 末尾追加：

```css
.file-link {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
  1390|}
.file-link:hover {
  text-decoration-color: var(--accent);
}
button.file-link {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  padding: 0;
  1400|  text-align: left;
}
button.user-attach-chip {
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.preview {
  1410|  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  min-width: 280px;
  border-left: 1px solid var(--border);
  background: var(--bg);
}
.preview-resize {
  position: absolute;
  1420|  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1;
}
.preview-head {
  display: flex;
  align-items: center;
  1430|  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  font-size: 13px;
}
.preview-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  1440|  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.preview-head button {
  font-size: 13px;
  padding: 2px 8px;
}
.preview-body {
  1450|  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.preview-frame {
  flex: 1;
  width: 100%;
  border: none;
  1460|  background: #fff;
}
.preview-image,
.preview-video {
  max-width: 100%;
  margin: 12px auto;
  display: block;
}
.preview-markdown,
.preview-code {
  1470|  padding: 12px 16px;
}
.preview-text {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  white-space: pre;
}
.preview-note {
  font-size: 12px;
  1480|  color: var(--warn);
  margin-bottom: 8px;
}
.preview-empty {
  margin: auto;
  padding: 24px;
  color: var(--muted);
  text-align: center;
}

  1490|@media (max-width: 900px) {
  .preview {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    max-width: 100%;
    box-shadow: -8px 0 24px rgb(0 0 0 / 0.2);
  }
  1500|}
```

（`.preview-title` 用 `direction: rtl` 让长路径从左边省略、保留文件名；如果路径里的标点显示位置不对，改回 `ltr`。）

- [ ] **Step 5: typecheck、build、冒烟**

Run：`pnpm --filter @typescript-agent-harness/web typecheck && pnpm -r build && pnpm test`
Expected：无类型错误；全部测试 PASS。

  1510|浏览器冒烟（临时 HOME，不碰真实 `~/.tah`）：

```bash
SMOKE=$(mktemp -d) && mkdir -p "$SMOKE/home" "$SMOKE/proj/site" && cd "$SMOKE/proj" \
  && printf '# Demo\n\n![dot](site/dot.svg)\n\nSee [the site](site/index.html).\n' > README.md \
  && printf '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="teal"/></svg>' > site/dot.svg \
  && printf '<link rel="stylesheet" href="style.css"><h1>Hello</h1><script>fetch("/api/sessions").then(r => document.body.append(" api:" + r.status)).catch(() => document.body.append(" api:blocked"))</script>' > site/index.html \
  && printf 'h1{color:teal}' > site/style.css \
  && HOME="$SMOKE/home" node /Users/hongchaoling/Desktop/AgentHarness/packages/cli/dist/cli.js serve --mock --no-open --port 0
```

  1520|打开它打印的地址，发一条「看看」（mock 会列目录、读 README），然后检查：

1. 工具行 `read_file README.md` 的路径可点，面板打开显示渲染后的 Markdown，图里的圆点显示。
2. 面板里点「the site」，切到 `site/index.html`：标题是青色（相对 CSS 加载了），页面末尾显示 `api:blocked` 或 `api:401`（不是 `api:200`）。
3. 「Source」切到源码；「↻」刷新；「✕」关闭。
4. 拖动面板左边缘改变宽度，刷新网页后宽度保留。
5. 窗口宽度拖到 900px 以下，面板盖在消息流上。

用完 Ctrl+C 停掉，`rm -rf "$SMOKE"`。
  1530|
- [ ] **Step 6: 提交**

按 code-commit 技能提交 `packages/web/src/components/FilePreview.tsx`、`Messages.tsx`、`ToolLine.tsx`、`App.tsx`、`styles.css`。参考信息：`feat(web): 文件预览面板，对话里的路径可点`。

---

### Task 6: 文档、回归、验收

**Files:**
  1540|- Modify: `docs/design/file-preview.md`（状态行）
- Modify: `CHANGELOG.md`（`## Unreleased` 下加一条）

- [ ] **Step 1: 请用户手动验收**

在网页（`tah serve`）和 macOS 客户端各做一次，清单发给用户：

1. 点工具行、附件卡片、正文里的路径，分别打开图片、PDF、视频、Markdown、代码。
2. 打开一个引用相对 CSS 和外网 CDN 图表库的 HTML，样式和图表正常。
3. 让 Agent 修改正在预览的文件，面板自动更新。
  1550|4. HTML 里的脚本 `fetch("/api/sessions")` 失败。
5. 点一个文件夹外的路径，面板提示 Not found in this folder。

客户端里 PDF 不显示时：客户端不改 `packages/*`，在 `apps/desktop/src/main.ts` 的 `webPreferences` 里加 `plugins: true` 再验；这是客户端改动，单独提交。

等用户反馈，有失败项回到对应任务修。

- [ ] **Step 2: `docs/design/file-preview.md` 状态行**

```markdown
  1560|状态：✅ 已实现（v0.35）
```

- [ ] **Step 3: `CHANGELOG.md`，在 `## Unreleased` 下现有的 Desktop 段落之后加**

```markdown
Web (`tah serve`): **file preview** — file paths in the conversation open in a panel on the right: paths in file-tool lines (`read_file`, `write_file`, `edit_file`, `read_image_text`), attachment chips, Markdown links and inline code that look like paths. Images, PDF and video play in place; HTML renders with its relative CSS / JS / images and can load from the web, but runs sandboxed as an opaque origin (no sign-in cookie, no access to the tah API) — only preview HTML you trust; Markdown renders like replies; code is highlighted. The panel only reads files inside the open folder, is read-only, and reloads when a write, edit or command changes the file. Drag its edge to resize. New endpoints `GET /api/files/stat`, `GET /api/files/raw` (supports `Range`) and `GET /preview/<token>/<path>`; host `tool.start` / `tool.end` events and history tool items carry `path` for file tools.
```

- [ ] **Step 4: 文档构建、全量回归**
  1570|
Run：`pnpm docs:build && pnpm -r build && pnpm test && pnpm --filter desktop test`
Expected：全部成功。

- [ ] **Step 5: 确认没动不该动的包，提交**

Run：`git diff --stat a75703a HEAD -- packages/core packages/agent packages/tools packages/llm packages/mcp packages/permissions packages/storage packages/scheduler apps/desktop`
Expected：无输出（Task 6 Step 1 若改了客户端 `plugins: true`，`apps/desktop` 那一行是预期的）。

按 code-commit 技能提交 `docs/design/file-preview.md`、`CHANGELOG.md`。参考信息：`docs: 文件预览已实现，补更新日志`。
