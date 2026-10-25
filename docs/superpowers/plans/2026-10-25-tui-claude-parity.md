# TUI Claude 对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `tah chat` TUI 在渲染与核心交互上对齐 Claude Code 公开文档行为（模式、Markdown、`@`、历史搜索、外置编辑器等），不引入全屏/鼠标。

**Architecture:** 在现有 Ink `App` + `Transcript` 上增加互斥模式状态机；Markdown 经 `marked-terminal` 加强；`@` 直接调用 `matchFiles`；历史为内存 ring；外置编辑器可注入。

**Tech Stack:** Node.js ≥ 22、Ink 8、React 19、`marked` + `marked-terminal`、`node:test`。可依赖 `marked-terminal` 已带的 `supports-hyperlinks` / `cli-highlight`；不新增图片或全屏库。

**Spec:** `docs/superpowers/specs/2026-10-25-tui-claude-parity-design.md`

## Global Constraints

- 只改 `tah chat` TUI；不改 web、不改 `tah run` 逐行模式的行为承诺（`renderMarkdown` API 可加强，但 plain/NO_COLOR 仍无色）。
- 不做 alternate screen、鼠标、vim、`!` shell、Mermaid/LaTeX 图。
- 历史 ring 不落盘；上限 200。
- 错误文案：`editor unavailable`、`editor failed`。
- 测试从 `../src/...ts` 导入纯函数；Ink 测需先 `pnpm --filter @typescript-agent-harness/cli build` 时从 dist 导入（与现 `tui.test.ts` 一致）。
- 不提交除非用户要求；不 bump 版本除非用户要求。

## File map

| File | Role |
| --- | --- |
| `packages/cli/src/markdown.ts` | `renderMarkdown(text, opts?)` with width / color |
| `packages/cli/src/tui/prompt-history.ts` | ring + filter |
| `packages/cli/src/tui/external-editor.ts` | temp file + spawn editor |
| `packages/cli/src/tui/editor.ts` | kill/yank/word move |
| `packages/cli/src/tui/transcript.ts` | optional `model` on assistant items |
| `packages/cli/src/tui/app.tsx` | modes, keys, `@` menu, stash, todos footer, hints |
| `packages/cli/src/tui/run.tsx` | pass columns into markdown if needed |
| `packages/cli/test/markdown.test.ts` | reflow / NO_COLOR |
| `packages/cli/test/prompt-history.test.ts` | ring / filter |
| `packages/cli/test/external-editor.test.ts` | inject spawn |
| `packages/cli/test/tui-editor.test.ts` | K/U/W/Y (extend or create) |
| `packages/cli/test/tui.test.ts` | mode / `@` smoke if feasible |

---

### Task 1: Markdown reflow + color-aware render

**Files:**
- Modify: `packages/cli/src/markdown.ts`
- Modify: `packages/cli/src/tui/run.tsx` (pass width when constructing transcript render)
- Test: `packages/cli/test/markdown.test.ts`

**Interfaces:**
- Consumes: `marked`, `marked-terminal`
- Produces:

```ts
export type MarkdownOptions = { width?: number; color?: boolean };

export function renderMarkdown(text: string, opts?: MarkdownOptions): string;
```

When `opts.color === false` or `useColor()` is false, strip/disable chalk styles (use a no-color markedTerminal config or post-strip). When `width` set, `reflowText: true` and that width (clamp ≥ 40). Default export behavior for one-arg call remains trimmed Markdown string.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../src/markdown.ts";

test("renderMarkdown reflows long paragraph to width", () => {
  const long = "word ".repeat(40).trim();
  const out = renderMarkdown(long, { width: 40, color: false });
  const lines = out.split("\n").filter(Boolean);
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((l) => l.replace(/\x1b\[[0-9;]*m/g, "").length <= 40));
});

test("renderMarkdown keeps a fenced code fence marker", () => {
  const out = renderMarkdown("```js\nconst x = 1;\n```", { color: false });
  assert.match(out, /const x = 1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/cli exec node --test --experimental-strip-types test/markdown.test.ts`  
Expected: FAIL (opts ignored or file missing assertions)

- [ ] **Step 3: Implement `renderMarkdown(text, opts?)`**

Build Marked with `markedTerminal({ reflowText: Boolean(opts?.width), width: opts?.width ?? 80, ... })`. For `color: false`, pass identity/style-less chalk wrappers or disable colors via env for that call only — prefer explicit options object so tests don’t depend on process env.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** (only if user asked to commit)

```bash
git add packages/cli/src/markdown.ts packages/cli/test/markdown.test.ts packages/cli/src/tui/run.tsx
git commit -m "$(cat <<'EOF'
feat(tui): reflow markdown to terminal width

EOF
)"
```

---

### Task 2: Prompt history ring

**Files:**
- Create: `packages/cli/src/tui/prompt-history.ts`
- Test: `packages/cli/test/prompt-history.test.ts`

**Interfaces:**
- Produces:

```ts
export type PromptHistory = {
  push(text: string): void;
  clear(): void;
  /** Newest-first matches; empty query returns recent up to limit. */
  search(query: string, limit?: number): string[];
};

export function createPromptHistory(max?: number): PromptHistory;
```

`max` default 200. `push` ignores empty/whitespace-only; consecutive duplicate of last entry ignored. `search` is case-insensitive substring; newest first.

- [ ] **Step 1: Failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPromptHistory } from "../src/tui/prompt-history.ts";

test("prompt history searches newest first and caps", () => {
  const h = createPromptHistory(3);
  h.push("alpha");
  h.push("beta one");
  h.push("beta two");
  h.push("gamma");
  assert.deepEqual(h.search("beta"), ["beta two", "beta one"]);
  assert.equal(h.search("").length, 3);
  assert.deepEqual(h.search(""), ["gamma", "beta two", "beta one"]);
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit if asked**

---

### Task 3: External editor helper

**Files:**
- Create: `packages/cli/src/tui/external-editor.ts`
- Test: `packages/cli/test/external-editor.test.ts`

**Interfaces:**
- Produces:

```ts
export type EditorRunner = (cmd: string, args: string[]) => Promise<{ code: number | null }>;

export async function editInEditor(
  initial: string,
  opts: {
    env?: NodeJS.ProcessEnv;
    run?: EditorRunner;
    writeFile?: (path: string, data: string) => Promise<void>;
    readFile?: (path: string) => Promise<string>;
    mkdtemp?: (prefix: string) => Promise<string>;
  },
): Promise<{ text: string } | { error: "editor unavailable" | "editor failed" }>;
```

Resolve command: `opts.env?.VISUAL || opts.env?.EDITOR || process.env.VISUAL || process.env.EDITOR`. If missing → `{ error: "editor unavailable" }`. Write temp `tah-prompt-*.txt`, run `[cmd, tempPath]` via `run` (default `spawn` sync-ish promise). Non-zero / throw → `{ error: "editor failed" }`. Success → read file contents (keep trailing newline policy: trimEnd only the final single newline if editor added one — simplest: return file string as-is).

- [ ] **Step 1: Failing test** with injected `run` / fs
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit if asked**

---

### Task 4: Editor kill / yank / word move

**Files:**
- Modify: `packages/cli/src/tui/editor.ts`
- Test: `packages/cli/test/tui-editor.test.ts` (create or extend)

**Interfaces:**
- Produces additions:

```ts
export function killLineEnd(e: Editor): { editor: Editor; killed: string };
export function killLineStart(e: Editor): { editor: Editor; killed: string };
export function killWordBack(e: Editor): { editor: Editor; killed: string };
export function yank(e: Editor, text: string): Editor;
export function moveWord(e: Editor, dir: "left" | "right"): Editor;
```

Word = run of letters/digits (Unicode letters via `\p{L}\p{N}`); punctuation separates (Claude doc alignment). `killWordBack` deletes back to previous whitespace (Ctrl+W semantics per spec: whitespace-delimited).

- [ ] **Step 1: Failing tests** for each function on a small Editor fixture
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit if asked**

---

### Task 5: Transcript mode fields + tool expand rules

**Files:**
- Modify: `packages/cli/src/tui/transcript.ts` — on assistant finalize, set `model` from snapshot.model when present
- Modify: `packages/cli/src/tui/app.tsx` — `HistoryItem` / `ToolLine`: `open` true shows longer result (40 lines); colorize lines starting with `- ` / `+ `

**Interfaces:**
- Assistant item: `{ kind: "assistant"; text: string; images?: string; model?: string }`

- [ ] **Step 1: Unit-test a pure `formatToolResult(result: string, open: boolean): string` helper** (extract if needed) for truncate + color when `color` true
- [ ] **Step 2: FAIL then implement**
- [ ] **Step 3: Wire `model` into assistant items in `Transcript`**
- [ ] **Step 4: In `HistoryItem`, when `open && item.model`, append dim model line**
- [ ] **Step 5: Existing transcript/Ink tests still pass**

Run: `pnpm --filter @typescript-agent-harness/cli test`

---

### Task 6: App modes — transcript / history / shortcuts

**Files:**
- Modify: `packages/cli/src/tui/app.tsx`
- Modify: `packages/cli/src/tui/run.tsx` if cwd needed for `@`
- Test: extend `packages/cli/test/tui.test.ts` with ink-testing-library for Ctrl+O / Esc where practical; pure wiring tests preferred for history fill

**Behavior checklist (implement in one cohesive pass):**

1. `mode: "normal" | "transcript" | "history"` state.
2. `Ctrl+O` toggles transcript; in transcript, `Esc`/`q` return normal (Esc no longer clears input first when mode is transcript).
3. `Ctrl+R` → history mode; type filters `promptHistory.search`; ↑↓; Enter inserts into editor; Esc cancels.
4. On successful `send`, `promptHistory.push(text)`.
5. `Ctrl+G` → `editInEditor`; apply text or set `imageError`-style dim line with error string.
6. `Ctrl+T` toggles `showTodos` footer from latest todos item / snap.
7. `Ctrl+S` stash/restore `{ editor, pendingImages }`.
8. Empty input `?` toggles `showHelp` hint block.
9. `Ctrl+L` → `setRedraw(n => n+1)` key on root Box to force remount/rerender.
10. `@` menu: detect `/(?:^|\s)@([^\s@]*)$/` on text before cursor; `matchFiles(host cwd, query)`; Tab/Enter insert path; mutually exclusive with slash menu.
11. Wire new editor kills to keys; keep yank buffer in ref.
12. Update footer hints per mode.

`matchFiles` import from `../serve/files.js`. Host must expose `cwd` — if `ChatHost` lacks it, read from `run.tsx` closure and pass `cwd` prop into `App`.

- [ ] **Step 1: Add `cwd` prop to App if missing; failing test that `@` insertion uses matchFiles with a temp dir fixture** (prefer testing a extracted `fileMentionQuery(text, col): string | undefined` + integration with matchFiles without full Ink)
- [ ] **Step 2: Implement mode state machine + keys**
- [ ] **Step 3: Manual smoke** — `pnpm --filter @typescript-agent-harness/cli build` then `tah chat` in a small cwd: Ctrl+O, Ctrl+R, @file, ?
- [ ] **Step 4: Run full cli tests**
- [ ] **Step 5: Commit if asked**

---

### Task 7: Spec polish + docs link

**Files:**
- Modify: `docs/superpowers/specs/2026-10-25-tui-claude-parity-design.md` — status → 已实现 when done; link plan
- No product README change unless user asks

- [ ] **Step 1: After Tasks 1–6 green, mark spec status ✅**
- [ ] **Step 2: Commit docs if user asks**

---

## Spec coverage check

| Spec item | Task |
| --- | --- |
| Markdown reflow / NO_COLOR | 1 |
| OSC 8 when supported | 1 (via marked-terminal defaults; verify manually) |
| Tool expand + diff color | 5 |
| Assistant model in transcript | 5 |
| Modes normal/transcript/history | 6 |
| Ctrl+R history ring | 2 + 6 |
| Ctrl+G editor | 3 + 6 |
| Ctrl+T / Ctrl+S / ? / Ctrl+L | 6 |
| @ matchFiles | 6 |
| Readline K/U/W/Y, Alt+B/F | 4 + 6 |
| Non-goals (fullscreen etc.) | not implemented |
| Images unchanged | no task touches protocol |

## Placeholder scan

No TBD steps. Commits gated on user request.
