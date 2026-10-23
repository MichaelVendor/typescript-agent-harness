# TUI 图片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tah chat` 的 TUI 能从剪贴板和本地路径收进图片，并在滚动区里用终端协议把图画出来。

**Architecture:** 纯函数负责认路径、认协议、把字节编码成控制序列。剪贴板是按系统拼出的一条命令。TUI 的 `Transcript` 在用户消息、写完的 Markdown 块和工具结果下面挂上这段序列。输入框把待发送图片放进现有附件库，再以附件 id 调用已有的 `send`。

**Tech Stack:** Node.js ≥ 22、`node:test`、`node:zlib`、Ink 8。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-23-tui-images-design.md`

## Global Constraints

- 入口只有 `tah chat` 的 TUI。`tah run` 不收图、不画图。
- `--plain` 和非终端输出不发图片控制序列。现有逐行模式继续只用 `renderMarkdown`。
- 这一轮只收 png、jpeg、webp、gif。不收文本文件。
- 不下载网页地址，不渲染 `data:`。
- 不引入图片解码库。PNG 的 IDAT 只用 `node:zlib` 解压。JPEG、GIF、WEBP 在 Kitty 和 Sixel 下不画（这两种协议吃不到压缩后的原字节）；iTerm 直接发送原字节的 base64。
- 单张最大 20 MiB，一条消息最多 20 张。超出用附件库现有的 `AttachmentError` 文案。
- 收图失败是输入框上方的灰色一行，不让 TUI 退出。画图失败保留路径文字，不向外抛。
- 错误文本：`clipboard has no image`、`image clipboard unavailable`。
- 回复和工具结果里的路径，真实路径必须在工作区里。用户拖入或粘贴的源文件可以在工作区外，拷进附件库再画。
- 直接构造 `Transcript` 且不传入 painter 时，行为与现在相同，现有 TUI 测试保持通过。
- 测试从 `../src/...ts` 导入。会渲染 Ink 的测试在跑之前执行 `pnpm --filter @typescript-agent-harness/cli build`，因为它和现有 `tui.test.ts` 一样从 `../dist/` 导入。

---

### Task 1: 从文本里找出要画的图片

**Files:**
- Create: `packages/cli/src/tui/images.ts`
- Test: `packages/cli/test/tui-images.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export type ImageKind = "png" | "jpeg" | "gif" | "webp";

export function imageKind(head: Buffer): ImageKind | undefined;

export function fitCells(pxW: number, pxH: number, columns: number): { cols: number; rows: number };

export function imagePaths(
  text: string,
  cwd: string,
  io: {
    realpath(p: string): string;
    size(p: string): number;
    head(p: string): Buffer;
  },
): string[];
```

`imageKind`：png 以 `89 50 4E 47` 开头；jpeg 以 `FF D8 FF` 开头；gif 以 `GIF87a` 或 `GIF89a` 开头；webp 在 0 处是 `RIFF` 且在 8 处是 `WEBP`。否则 `undefined`。

`fitCells`：`rows = min(20, max(1, pxH))`，`cols = min(max(1, columns), max(1, round(rows * pxW / pxH)))`。若 `cols` 被列数截断，再把 `rows` 收成 `min(20, max(1, round(cols * pxH / pxW)))`。宽高读不出来时用 40 列、12 行，列数再被 `columns` 截断。这个回退放在 Task 2 的 `encodeImage` 里，本任务只实现算式。

`imagePaths`：先去掉 `\x1b\[[0-9;]*m`。Markdown 图片用 `/!\[[^\]]*\]\(([^)\s]+)\)/g`。裸路径是按空白切开后的词。跳过 `http:`、`https:`、`data:`、以 `//` 开头的地址。相对路径相对 `cwd`。`realpath` 抛错、真实路径不在 `cwd` 内（相等，或带一个路径分隔符的前缀）、`size` 超过 `20 * 1024 * 1024`、扩展名不是 `png`/`jpg`/`jpeg`/`webp`/`gif`、或 `imageKind(head)` 为空，都不收。同一真实路径只收一次。最多 20 条。`realpath` 的返回值就是列表里的字符串。

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types packages/cli/test/tui-images.test.ts`

Expected: FAIL, `imageKind` is not exported.

- [ ] **Step 3: Write minimal implementation**

实现上面三个函数。工作区判断用 `path.resolve` 之后的字符串。扩展名用 `path.extname` 的小写，不含点。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types packages/cli/test/tui-images.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/tui/images.ts packages/cli/test/tui-images.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): 从回复里找出工作区内的图片路径

EOF
)"
```

---

### Task 2: 把图片字节编码成终端控制序列

**Files:**
- Modify: `packages/cli/src/tui/images.ts`
- Modify: `packages/cli/test/tui-images.test.ts`

**Interfaces:**
- Consumes: `imageKind`、`fitCells`
- Produces:

```ts
export type ImageProtocol = "kitty" | "iterm" | "sixel" | "none";

export function imageProtocol(env: NodeJS.ProcessEnv): ImageProtocol;

export function encodeImage(input: {
  protocol: ImageProtocol;
  bytes: Buffer;
  columns: number;
}): string;
```

`imageProtocol` 按这个顺序：

| 条件 | 结果 |
| --- | --- |
| `KITTY_WINDOW_ID` 非空，或 `TERM_PROGRAM` 为 `ghostty`，或 `TERM` 为 `xterm-kitty`，或 `WEZTERM_EXECUTABLE` 非空，或 `TERM_PROGRAM` 为 `WezTerm` | `"kitty"` |
| `TERM_PROGRAM` 为 `vscode` 或 `iTerm.app` | `"iterm"` |
| `WT_SESSION` 非空，或 `TERM` 为 `foot` | `"sixel"` |
| 其余 | `"none"` |

`encodeImage`：`protocol === "none"`、`imageKind` 为空、或 `bytes.length > 20 * 1024 * 1024` 时返回 `""`。宽高从文件头读：PNG 在偏移 16 和 20 处各一个大端 uint32（仅当 `imageKind` 为 png 且长度够）。GIF 在偏移 6 和 8 处各一个小端 uint16。读不出来用 `{ cols: min(40, columns), rows: 12 }`，再经 `fitCells` 的列数上限。JPEG、WEBP 这一轮不解析宽高，走这个回退。

Kitty 只接受 PNG（`f=100`）。JPEG、GIF、WEBP 在 `protocol === "kitty"` 时返回 `""`。Sixel 只编码能用 `zlib.inflateSync` 解开的 8-bit、非隔行、颜色类型 2 或 6 的 PNG；其他返回 `""`。

Kitty 占位字符的变音符表按这个顺序，索引就是行号或列号。超出表长的行列截到表长。表是 Kitty `rowcolumn-diacritics` 的全部 297 项：

```text
0305 030D 030E 0310 0312 033D 033E 033F 0346 034A 034B 034C 0350 0351 0352 0357 035B 0363 0364 0365 0366 0367 0368 0369 036A 036B 036C 036D 036E 036F 0483 0484 0485 0486 0487 0592 0593 0594 0595 0597 0598 0599 059C 059D 059E 059F 05A0 05A1 05A8 05A9 05AB 05AC 05AF 05C4 0610 0611 0612 0613 0614 0615 0616 0617 0657 0658 0659 065A 065B 065D 065E 06D6 06D7 06D8 06D9 06DA 06DB 06DC 06DF 06E0 06E1 06E2 06E4 06E7 06E8 06EB 06EC 0730 0732 0733 0735 0736 073A 073D 073F 0740 0741 0743 0745 0747 0749 074A 07EB 07EC 07ED 07EE 07EF 07F0 07F1 07F3 0816 0817 0818 0819 081B 081C 081D 081E 081F 0820 0821 0822 0823 0825 0826 0827 0829 082A 082B 082C 082D 0951 0953 0954 0F82 0F83 0F86 0F87 135D 135E 135F 17DD 193A 1A17 1A75 1A76 1A77 1A78 1A79 1A7A 1A7B 1A7C 1B6B 1B6D 1B6E 1B6F 1B70 1B71 1B72 1B73 1CD0 1CD1 1CD2 1CDA 1CDB 1CE0 1DC0 1DC1 1DC3 1DC4 1DC5 1DC6 1DC7 1DC8 1DC9 1DCB 1DCC 1DD1 1DD2 1DD3 1DD4 1DD5 1DD6 1DD7 1DD8 1DD9 1DDA 1DDB 1DDC 1DDD 1DDE 1DDF 1DE0 1DE1 1DE2 1DE3 1DE4 1DE5 1DE6 1DFE 20D0 20D1 20D4 20D5 20D6 20D7 20DB 20DC 20E1 20E7 20E9 20F0 2CEF 2CF0 2CF1 2DE0 2DE1 2DE2 2DE3 2DE4 2DE5 2DE6 2DE7 2DE8 2DE9 2DEA 2DEB 2DEC 2DED 2DEE 2DEF 2DF0 2DF1 2DF2 2DF3 2DF4 2DF5 2DF6 2DF7 2DF8 2DF9 2DFA 2DFB 2DFC 2DFD 2DFE 2DFF A66F A67C A67D A6F0 A6F1 A8E0 A8E1 A8E2 A8E3 A8E4 A8E5 A8E6 A8E7 A8E8 A8E9 A8EA A8EB A8EC A8ED A8EE A8EF A8F0 A8F1 AAB0 AAB2 AAB3 AAB7 AAB8 AABE AABF AAC1 FE20 FE21 FE22 FE23 FE24 FE25 FE26 10A0F 10A38 1D185 1D186 1D187 1D188 1D189 1D1AA 1D1AB 1D1AC 1D1AD 1D242 1D243 1D244
```

图像 id 从 1 递增，模块内计数即可。Kitty 传输与占位：

```ts
const b64 = bytes.toString("base64");
const transmit = `\x1b_Ga=T,f=100,t=d,q=2,U=1,i=${id},c=${cols},r=${rows};${b64}\x1b\\`;
const color = `\x1b[38;5;${id}m`;
// 每一行：color + 重复 cols 次（U+10EEEE + DIACRITICS[row] + DIACRITICS[col]）+ `\x1b[39m`
```

iTerm：

```ts
const seq = `\x1b]1337;File=name=${Buffer.from("image").toString("base64")};inline=1;width=${cols};height=${rows};preserveAspectRatio=1:${bytes.toString("base64")}\x07`;
return seq + "\n".repeat(rows);
```

Sixel：先把 PNG 缩放到 `cols * rows` 个像素（最近邻），再按 6 行一条带写出。调色板用 `r & 0xc0, g & 0xc0, b & 0xc0`。序列以 `\x1bPq` 开头、以 `\x1b\\` 结尾，后面再补 `rows` 个换行。

- [ ] **Step 1: Write the failing test**

把下面的用例加进 `tui-images.test.ts`。1×1 PNG 用这串 base64：`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==`。

```ts
import { encodeImage, imageProtocol } from "../src/tui/images.ts";
import { renderMarkdown } from "../src/markdown.ts";

const png1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
  assert.equal(encodeImage({ protocol: "none", bytes: png1, columns: 80 }), "");
  assert.equal(encodeImage({ protocol: "kitty", bytes: Buffer.from([0xff, 0xd8, 0xff]), columns: 80 }), "");
  assert.equal(renderMarkdown("![a](shot.png)").includes("\x1b]1337"), false);
  assert.equal(renderMarkdown("![a](shot.png)").includes("\x1b_G"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types packages/cli/test/tui-images.test.ts`

Expected: FAIL, `imageProtocol` is not exported.

- [ ] **Step 3: Write minimal implementation**

按上面的接口实现。PNG 解压只处理颜色类型 2 和 6、位深 8、无隔行。滤镜字节按 PNG 的 None/Sub/Up/Average/Paeth 还原。解不出来就返回 `""`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types packages/cli/test/tui-images.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/tui/images.ts packages/cli/test/tui-images.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): 按终端协议把图片编码成控制序列

EOF
)"
```

---

### Task 3: 读取剪贴板，并判断一次粘贴是不是图片路径

**Files:**
- Create: `packages/cli/src/tui/clipboard.ts`
- Modify: `packages/cli/test/tui-images.test.ts`

**Interfaces:**
- Consumes: `imageKind`
- Produces:

```ts
export type CommandResult = { stdout: Buffer; code: number | null; missing?: boolean };
export type RunCommand = (file: string, args: string[]) => Promise<CommandResult>;

export function pastedImagePaths(text: string, isImageFile: (path: string) => boolean): string[] | undefined;

export function readClipboard(platform: NodeJS.Platform, run: RunCommand): Promise<{ bytes?: Buffer; error?: string }>;
```

`pastedImagePaths`：`trim` 后按空白切开。空串返回 `undefined`。每一个词都让 `isImageFile` 为真时，返回这些词。否则 `undefined`。

`readClipboard`：

- `darwin`：`osascript -l JavaScript`，脚本用 AppKit 读通用粘贴板。没有图时进程以非 0 退出。标准输出是 PNG 的 base64。解码后 `imageKind` 不是四种图片，或退出非 0、或输出为空：`{ error: "clipboard has no image" }`。
- `linux`：先 `wl-paste`，参数 `["--type", "image/png"]`。`missing` 为真时再跑 `xclip`，参数 `["-selection", "clipboard", "-t", "image/png", "-o"]`。两次都 `missing`：`{ error: "image clipboard unavailable" }`。跑了但 stdout 为空或不是图片：`{ error: "clipboard has no image" }`。
- `win32`：`powershell.exe`，参数以 `-NoProfile`、`-Command` 开头，把剪贴板图片存成 PNG 写到标准输出。失败或不是图片：`{ error: "clipboard has no image" }`。
- 其他平台：`{ error: "image clipboard unavailable" }`。

macOS 脚本的正文固定为：有图时把 PNG 的 base64 打到 stdout 并以 0 退出；没有图时以 1 退出。实现用 `ObjC.import("AppKit")` 从 `NSPasteboard.generalPasteboard` 取 `NSImage`，再转成 PNG。

- [ ] **Step 1: Write the failing test**

```ts
import { pastedImagePaths, readClipboard } from "../src/tui/clipboard.ts";

test("pastedImagePaths accepts only an all-image paste", () => {
  const ok = (p: string) => p === "/tmp/a.png" || p === "shot.jpeg";
  assert.deepEqual(pastedImagePaths("/tmp/a.png shot.jpeg", ok), ["/tmp/a.png", "shot.jpeg"]);
  assert.equal(pastedImagePaths("/tmp/a.png and more", ok), undefined);
  assert.equal(pastedImagePaths("   ", ok), undefined);
});

test("readClipboard picks the platform command", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const seen: string[] = [];
  const run = async (file: string, args: string[]) => {
    seen.push(`${file} ${args[0] ?? ""}`);
    if (file === "wl-paste") return { stdout: Buffer.alloc(0), code: 127, missing: true };
    if (file === "xclip") return { stdout: png, code: 0 };
    if (file === "osascript") return { stdout: Buffer.from(png.toString("base64")), code: 0 };
    if (file === "powershell.exe") return { stdout: png, code: 0 };
    return { stdout: Buffer.alloc(0), code: 1 };
  };
  assert.deepEqual(await readClipboard("darwin", run), { bytes: png });
  assert.deepEqual(await readClipboard("linux", run), { bytes: png });
  assert.equal(seen.includes("wl-paste --type"), true);
  assert.equal(seen.includes("xclip -selection"), true);
  assert.deepEqual(await readClipboard("win32", run), { bytes: png });
  const missing = async () => ({ stdout: Buffer.alloc(0), code: 127, missing: true });
  assert.deepEqual(await readClipboard("linux", missing), { error: "image clipboard unavailable" });
  const empty = async () => ({ stdout: Buffer.alloc(0), code: 1 });
  assert.deepEqual(await readClipboard("darwin", empty), { error: "clipboard has no image" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types packages/cli/test/tui-images.test.ts`

Expected: FAIL, `pastedImagePaths` is not exported.

- [ ] **Step 3: Write minimal implementation**

实现 `clipboard.ts`。`darwin` 的 base64 解码用 `Buffer.from(stdout.toString().trim(), "base64")`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types packages/cli/test/tui-images.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/tui/clipboard.ts packages/cli/test/tui-images.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): 从三个系统的剪贴板读取图片

EOF
)"
```

---

### Task 4: 滚动区在文字下面挂上图画

**Files:**
- Modify: `packages/cli/src/tui/transcript.ts`
- Modify: `packages/cli/src/tui/app.tsx`（`StaticItem` 把 `item.images` 画在文字下面）
- Modify: `packages/cli/src/tui/run.tsx`
- Test: `packages/cli/test/tui-images.test.ts`

**Interfaces:**
- Consumes: `encodeImage`、`imageProtocol`、`imagePaths`、`HistoryItem` 上已有的 `attachments`
- Produces: `Transcript` 的第二参。不传时和现在一样。

```ts
export type ImagePainter = {
  cwd: string;
  columns(): number;
  protocol: ImageProtocol;
  readFile(path: string): Buffer | undefined;
  attachmentPath(id: string): string | undefined;
};

constructor(render: (markdown: string) => string, painter?: ImagePainter)
```

`user`、`assistant`、`tool` 三项增加可选字段 `images?: string`。有内容时 `StaticItem` 在原文下面再输出一个 `<Text>{item.images}</Text>`。

画图规则：

- 用户消息：每个 `kind === "image"` 的附件，用 `attachmentPath(id)` 再 `readFile`。读不到就跳过。
- 助手块和历史里的助手文本：对这段文本调用 `imagePaths`（`realpath`/`size`/`head` 用 `fs`，抛错当成没有）。
- 工具结果：对 `result` 调用 `imagePaths`。不扫 `summary`。
- 每条路径 `encodeImage({ protocol, bytes, columns: columns() })`，空串丢掉，其余用 `\n` 接起来。一个都没有就不设 `images`。
- `readFile` 或编码抛错时跳过这一张。

`run.tsx` 传入 painter：`protocol` 来自 `imageProtocol(process.env)`，`columns` 来自 `process.stdout.columns || 80`，`cwd` 来自 `flags.cwd`。`attachmentPath` 用 `createAttachmentStore(flags.cwd).get(id)?.path`。`readFile` 用 `readFileSync`，异常返回 `undefined`。不要在还没收到图片时额外做别的事；`createAttachmentStore` 会创建目录，这和网页第一次上传时一样，可以在构造 painter 时调用一次。

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transcript } from "../src/tui/transcript.ts";

test("a user image and a tool path become protocol sequences", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-img-"));
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
```

没有 painter 的 `new Transcript((s) => s)` 收到助手 `text` 事件 `shot.png` 后，对应项没有 `images`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types packages/cli/test/tui-images.test.ts`

Expected: FAIL，用户项没有 `images`。

- [ ] **Step 3: Write minimal implementation**

按接口改 `transcript.ts`、`StaticItem` 和 `run.tsx`。历史里的用户附件和助手文本走同一套。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types packages/cli/test/tui-images.test.ts`

Expected: PASS。然后再跑 `packages/cli/test/tui.test.ts` 之前先 `pnpm --filter @typescript-agent-harness/cli build`，现有 TUI 测试仍 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/tui/transcript.ts packages/cli/src/tui/app.tsx packages/cli/src/tui/run.tsx packages/cli/test/tui-images.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): 滚动区在文字下面画出图片

EOF
)"
```

---

### Task 5: 输入框收图并连同消息发送

**Files:**
- Modify: `packages/cli/src/tui/clipboard.ts`（增加 `ingestClipboard`）
- Modify: `packages/cli/src/tui/app.tsx`
- Modify: `packages/cli/src/tui/run.tsx`
- Modify: `packages/cli/test/tui-images.test.ts`
- Modify: `packages/cli/test/tui.test.ts`

**Interfaces:**
- Consumes: `pastedImagePaths`、`readClipboard`、`imageKind`、`createAttachmentStore`、`host.send(text, ids)`、`QueuedMessage.attachments`
- Produces: `App` 的可选 `images` 参数。不传时现有测试的按键行为不变。

```ts
export async function ingestClipboard(images: {
  readClipboard(): Promise<{ bytes?: Buffer; error?: string }>;
  save(bytes: Buffer, name: string): { id: string; name: string } | { error: string };
}): Promise<{ image?: { id: string; name: string }; error?: string }>;
```

`ingestClipboard` 调用 `readClipboard`。有 `error` 或没有 `bytes` 时返回 `{ error: error ?? "clipboard has no image" }`。有字节时 `save(bytes, "clipboard." + 扩展名)`，扩展名由 `imageKind` 决定。`save` 返回 `error` 时原样返回。Alt+V 只调用这个函数。

```ts
export type PendingImage = { id: string; name: string };

export type AppProps = {
  host: ChatHost;
  transcript: Transcript;
  maxSteps: number;
  color: boolean;
  images?: {
    readClipboard(): Promise<{ bytes?: Buffer; error?: string }>;
    save(bytes: Buffer, name: string): { id: string; name: string } | { error: string };
    copyFile(path: string): { id: string; name: string } | { error: string };
    isImageFile(path: string): boolean;
  };
};
```

`run.tsx` 传入真实实现：`readClipboard(process.platform, 默认用 node:child_process spawn 收集 stdout)`，`save` / `copyFile` 走 `createAttachmentStore(flags.cwd)`。`copyFile` 读源文件再 `save`。MIME 由 `imageKind` 决定：`png → image/png`，`jpeg → image/jpeg`，`gif → image/gif`，`webp → image/webp`。名字用源文件名；剪贴板用 `clipboard.png` 这类扩展名。`AttachmentError` 变成 `{ error: err.message }`。

输入框行为：

- 粘贴回调：`pastedImagePaths(text, images.isImageFile)` 有结果时，逐个 `copyFile`，不把这段文字插入输入框。任一返回 `error` 时，输入框上方灰色一行显示该文案，已经收进的保留。没有 `images` 或结果是 `undefined` 时，照现在这样 `insert`。
- Alt+V（`key.meta && input === "v"`）只在输入框正在接收文字时触发，包括一轮还在跑、用户在排队下一条。审批、提问、会话选择、步数上限提示开着时不读剪贴板。成功则 `save` 后追加到待发送列表。`error` 显示在输入框上方灰色一行。
- 待发送文件名在输入框边框上方，灰色一行，空格隔开。
- 输入框为空且正在接收文字时，Backspace 去掉最后一张，不再把按键交给编辑器。
- 提交：待发送列表非空时，即使文字为空白也调用 `host.send(text.trim(), ids)`，然后清空编辑器和待发送列表。`send` 失败仍走现有的 `fail`。
- 队列行在文字后面加上附件文件名，空格隔开。
- 灰色错误在下一次成功收图或成功提交时清掉。

- [ ] **Step 1: Write the failing test**

把 `ingestClipboard` 的用例加进 `tui-images.test.ts`，从 `../src/tui/clipboard.ts` 导入：

```ts
test("ingestClipboard calls the injected reader", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const calls: string[] = [];
  const images = {
    readClipboard: async () => {
      calls.push("read");
      return { bytes: png };
    },
    save: (_bytes: Buffer, name: string) => ({ id: "9", name }),
  };
  assert.deepEqual(await ingestClipboard(images), { image: { id: "9", name: "clipboard.png" } });
  assert.deepEqual(calls, ["read"]);
  const empty = { readClipboard: async () => ({ error: "clipboard has no image" }), save: images.save };
  assert.deepEqual(await ingestClipboard(empty), { error: "clipboard has no image" });
});
```

在 `tui.test.ts` 里追加粘贴用例。测试从 `../dist/tui/app.js` 导入，所以要先有一次构建才能加载；这一步预期失败的是行为，不是模块缺失。粘贴用 Ink 的 bracketed paste：`\x1b[200~/tmp/a.png\x1b[201~`。实现以 `usePaste` 为准。

```ts
test("a paste of only image paths is saved and not inserted", async () => {
  const saved: string[] = [];
  const sent: { text: string; ids?: string[] }[] = [];
  const host = {
    ...baseHost,
    send: async (text: string, ids?: string[]) => {
      sent.push({ text, ids });
    },
  };
  const images = {
    readClipboard: async () => ({ error: "clipboard has no image" }),
    save: (bytes: Buffer, name: string) => ({ id: "1", name }),
    copyFile: (p: string) => {
      saved.push(p);
      return { id: String(saved.length), name: p };
    },
    isImageFile: (p: string) => p.endsWith(".png"),
  };
  const transcript = new Transcript((s) => s);
  const app = render(createElement(App, { host, transcript, maxSteps: Infinity, color: false, images } as never));
  transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
  app.stdin.write("/tmp/a.png\n");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(saved, ["/tmp/a.png"]);
  assert.equal(sent.length, 0);
  app.stdin.write("\r");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent[0], { text: "", ids: ["1"] });
  app.unmount();
});
```

`baseHost` 复用文件顶部的 `host` 对象，但 `send` 换成记录用的函数。粘贴若被测试库当成逐字输入而不是 `usePaste`，改用 Ink 的 bracketed paste 序列 `\x1b[200~/tmp/a.png\x1b[201~`。实现以 `usePaste` 为准。

再加一个用例：`images` 不传时，输入 `/tmp/a.png` 再回车，`send` 收到的是这串文字，且没有附件 id。这锁住现有行为。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test --experimental-strip-types packages/cli/test/tui.test.ts`

Expected: FAIL，粘贴被当成文字发送，`saved` 仍为空。

- [ ] **Step 3: Write minimal implementation**

按接口改 `app.tsx` 和 `run.tsx`。默认 `spawn` 收集子进程 stdout 为 `Buffer`，`code` 非 0 且 `error.code === "ENOENT"` 时 `missing: true`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test --experimental-strip-types packages/cli/test/tui-images.test.ts packages/cli/test/tui.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/tui/clipboard.ts packages/cli/src/tui/app.tsx packages/cli/src/tui/run.tsx packages/cli/test/tui-images.test.ts packages/cli/test/tui.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): tah chat 可以贴进图片并发送

EOF
)"
```
