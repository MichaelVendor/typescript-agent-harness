# TUI 模块扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让项目在 `tui/` 里用 TSX 声明 TUI 模块，按插槽挂到 `tah chat`；这一版只渲染 `above-input`，交互模块可聚焦并用 `ctx.send` 走输入框同一条发送路径。

**Architecture:** 类型与 `defineTuiModule` 放在 CLI 公共出口。`loadTuiModules` 只用 jiti 扫 `tui/`，不进 `loadProject`。`runTui` 把挂载列表传给 Ink `App`；`App` 在队列和输入框之间画面板，并用 `Ctrl+P` / `Esc` 管焦点。`ctx.send` 在未聚焦时抛错。

**Tech Stack:** Node.js ≥ 22、Ink 8、React 19、jiti 2、`node:test`、`ink-testing-library`。

**Spec:** `docs/superpowers/specs/2026-10-25-tui-modules-design.md`

## Global Constraints

- 只在 `tah chat` 的 TUI 路径加载。`tah run`、`tah serve`、`--plain`、非 TTY 不读 `tui/`。
- `loadProject` 不扫 `tui/`。`plugins/` 不承载界面。
- 挂载插槽只有 `above-input`。`footer`、`transcript` 和任何其他 `slot` 不进入列表，各打一行 notice。
- `id` 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，项目内唯一。默认是文件名去掉扩展名。
- 每块最多 8 行（含标题）。返回 `null` 不占行。一块抛错只显示 `tui: <id>: <message>`。
- `ctx.send` 调用 `host.send`。未聚焦抛 `tui: <id> is not focused`。不提供 `cancel` / `reset` / `compact` / 附件。
- 有 `interactive: true` 的模块时，`Ctrl+P` 轮流聚焦，最后一个之后回到输入框。`Esc` 只交还焦点，不清草稿、不取消本轮。没有这种模块时不占用 `Ctrl+P`。
- 审批卡、提问卡、会话选择器占键盘时，不把焦点交给模块。
- 不热更新 `tui/`。不 bump 版本。不提交，除非用户要求。
- 纯函数测试用 `node --experimental-strip-types` 从 `../src/...ts` 导入。Ink 测试先 build，从 `../dist/...js` 导入，和 `packages/cli/test/tui.test.ts` 一样。

## File map

| File | Role |
| --- | --- |
| `packages/cli/src/tui/modules.ts` | `TuiSlot`、`TuiModule`、`TuiCtx`、`defineTuiModule`、`useTuiInput`、`panelSend` |
| `packages/cli/src/tui/load-modules.ts` | `loadTuiModules` |
| `packages/cli/src/tui/panel.tsx` | 8 行裁切、标题、错误边界 |
| `packages/cli/src/tui/app.tsx` | 渲染 `above-input`、焦点、把高度算进 `chrome` |
| `packages/cli/src/tui/run.tsx` | 加载并把 notice 交给 transcript |
| `packages/cli/src/index.ts` | 导出类型、`defineTuiModule`、`useTuiInput`、`Text`、`Box` |
| `packages/cli/test/tui-modules.test.ts` | 发送门闩与加载器 |
| `packages/cli/test/tui-modules-ui.test.ts` | Ink：渲染、`Ctrl+P`、`Esc` |
| `docs/design/project-convention.md` | `tui/` 约定一节 |
| `docs/design/tui.md` | 指到本规格 |

---

### Task 1: 模块契约与发送门闩

**Files:**
- Create: `packages/cli/src/tui/modules.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/tui-modules.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `TuiSlot = "above-input" | "footer" | "transcript"`
  - `MOUNTED_SLOTS = ["above-input"]`
  - `TuiUsage = { promptTokens: number; completionTokens: number; totalTokens: number }`
  - `TuiCtx` 字段与规格一致（`cwd`、`sessionId`、`busy`、`focused`、`model?`、`usage?`、`sessionUsage?`、`todos`、`send`）
  - `TuiModule`：`id?`、`slot`、`title?`、`interactive?`、`Component`
  - `defineTuiModule(module: TuiModule): TuiModule`
  - `useTuiInput(ctx: TuiCtx, handler: (input: string, key: import("ink").Key) => void): void` — 仅 `ctx.focused` 时调用 handler；`key.escape` 或 `key.ctrl && input === "p"` 直接返回
  - `panelSend(id: string, focused: boolean, send: (text: string) => Promise<void>): (text: string) => Promise<void>`

- [ ] **Step 1: Write the failing test**

`packages/cli/test/tui-modules.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { defineTuiModule, panelSend } from "../src/tui/modules.ts";

test("defineTuiModule returns the same object", () => {
  const Component = () => null;
  const mod = defineTuiModule({ slot: "above-input", Component });
  assert.equal(mod.slot, "above-input");
  assert.equal(mod.Component, Component);
});

test("panelSend calls through only while focused", async () => {
  const sent: string[] = [];
  const send = panelSend("cost", false, async (text) => {
    sent.push(text);
  });
  await assert.rejects(send("hi"), /tui: cost is not focused/);
  assert.deepEqual(sent, []);
  const open = panelSend("cost", true, async (text) => {
    sent.push(text);
  });
  await open("hi");
  assert.deepEqual(sent, ["hi"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test packages/cli/test/tui-modules.test.ts`

Expected: FAIL，找不到 `../src/tui/modules.ts`。

- [ ] **Step 3: Write minimal implementation**

`packages/cli/src/tui/modules.ts`：

```ts
import { useInput, type Key } from "ink";
import type { ReactNode } from "react";

export const TUI_SLOTS = ["above-input", "footer", "transcript"] as const;
export type TuiSlot = (typeof TUI_SLOTS)[number];
export const MOUNTED_SLOTS: readonly TuiSlot[] = ["above-input"];

export type TuiUsage = { promptTokens: number; completionTokens: number; totalTokens: number };
export type TuiTodo = { content: string; status: string };

export type TuiCtx = {
  cwd: string;
  sessionId: string;
  busy: boolean;
  focused: boolean;
  model?: string;
  usage?: TuiUsage;
  sessionUsage?: TuiUsage;
  todos: TuiTodo[];
  send(text: string): Promise<void>;
};

export type TuiModule = {
  id?: string;
  slot: TuiSlot;
  title?: string;
  interactive?: boolean;
  Component(props: { ctx: TuiCtx }): ReactNode;
};

export function defineTuiModule(module: TuiModule): TuiModule {
  return module;
}

export function panelSend(
  id: string,
  focused: boolean,
  send: (text: string) => Promise<void>,
): (text: string) => Promise<void> {
  return (text) => {
    if (!focused) return Promise.reject(new Error(`tui: ${id} is not focused`));
    return send(text);
  };
}

export function useTuiInput(ctx: TuiCtx, handler: (input: string, key: Key) => void): void {
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === "p")) return;
      handler(input, key);
    },
    { isActive: ctx.focused },
  );
}
```

在 `packages/cli/src/index.ts` 末尾追加：

```ts
export { Box, Text } from "ink";
export {
  defineTuiModule,
  useTuiInput,
  type TuiCtx,
  type TuiModule,
  type TuiSlot,
  type TuiTodo,
  type TuiUsage,
} from "./tui/modules.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test packages/cli/test/tui-modules.test.ts`

Expected: PASS（2 个测试）。

- [ ] **Step 5: Leave the diff uncommitted**

除非用户要求提交。建议信息：`feat(cli): 增加 TUI 模块类型与发送门闩`。

---

### Task 2: 加载 `tui/`

**Files:**
- Create: `packages/cli/src/tui/load-modules.ts`
- Modify: `packages/cli/test/tui-modules.test.ts`

**Interfaces:**
- Consumes: `TuiModule`、`TuiSlot`、`MOUNTED_SLOTS`、`ProjectError`、`isProject`（`packages/cli/src/project.ts`）
- Produces:
  - `loadTuiModules(cwd: string): Promise<{ modules: (TuiModule & { id: string })[]; notices: string[] }>`
  - 非项目或没有 `tui/`：`{ modules: [], notices: [] }`
  - notice 文案：`tui: <id> declares slot "<slot>", which this version does not mount`

- [ ] **Step 1: Write the failing test**

在 `packages/cli/test/tui-modules.test.ts` 追加。用临时目录，`package.json` 含 `"devDependencies": { "@typescript-agent-harness/cli": "*" }`。文件用 `.mjs`，避免这一任务依赖 JSX。

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadTuiModules } from "../src/tui/load-modules.ts";

const marker = JSON.stringify({ type: "module", devDependencies: { "@typescript-agent-harness/cli": "*" } });

function project(files: Record<string, string>, withMarker = true): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-tui-mod-"));
  const all = withMarker ? { "package.json": marker, ...files } : files;
  for (const [rel, content] of Object.entries(all)) {
    const file = path.join(cwd, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return cwd;
}

const mod = (slot: string, id?: string) =>
  `export default { slot: ${JSON.stringify(slot)}, ${id ? `id: ${JSON.stringify(id)}, ` : ""}Component() { return null; } };\n`;

test("loadTuiModules sorts mounted slots and skips the rest", async () => {
  const cwd = project({
    "tui/b-cost.mjs": mod("above-input"),
    "tui/a-footer.mjs": mod("footer"),
    "tui/c-extra.mjs": mod("above-input", "extra"),
    "tui/_skip.mjs": mod("above-input", "skip"),
    "tui/nested/nope.mjs": mod("above-input", "nope"),
  });
  const loaded = await loadTuiModules(cwd);
  assert.deepEqual(loaded.modules.map((m) => m.id), ["b-cost", "extra"]);
  assert.deepEqual(loaded.notices, [
    'tui: a-footer declares slot "footer", which this version does not mount',
  ]);
});

test("loadTuiModules rejects a bad export, a bad id, and a duplicate id", async () => {
  await assert.rejects(loadTuiModules(project({ "tui/nope.mjs": "export default {};\n" })), /tui\/nope\.mjs/);
  await assert.rejects(
    loadTuiModules(project({ "tui/Bad.mjs": mod("above-input") })),
    /invalid/,
  );
  await assert.rejects(
    loadTuiModules(project({
      "tui/one.mjs": mod("above-input", "same"),
      "tui/two.mjs": mod("above-input", "same"),
    })),
    /duplicate/,
  );
});

test("loadTuiModules returns nothing outside a project", async () => {
  const cwd = project({ "tui/cost.mjs": mod("above-input") }, false);
  assert.deepEqual(await loadTuiModules(cwd), { modules: [], notices: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test packages/cli/test/tui-modules.test.ts`

Expected: FAIL，找不到 `load-modules.ts`。Task 1 的测试仍 PASS。

- [ ] **Step 3: Write minimal implementation**

`packages/cli/src/tui/load-modules.ts` 复制 `project.ts` 的扫描规则，扩展名加上 `tsx|jsx`。jiti 打开 JSX，否则 `.tsx` 模块以后加载失败：

```ts
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { ProjectError, isProject } from "../project.js";
import { MOUNTED_SLOTS, TUI_SLOTS, type TuiModule, type TuiSlot } from "./modules.js";

const SOURCE = /\.(tsx|ts|jsx|js|mts|mjs)$/;
const SKIPPED = /^_|\.d\.m?ts$|\.(test|spec)\./;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SOURCE.test(e.name) && !SKIPPED.test(e.name))
    .map((e) => e.name)
    .sort();
}

function isSlot(value: string): value is TuiSlot {
  return (TUI_SLOTS as readonly string[]).includes(value);
}

export async function loadTuiModules(cwd: string): Promise<{
  modules: (TuiModule & { id: string })[];
  notices: string[];
}> {
  if (!isProject(cwd)) return { modules: [], notices: [] };
  const dir = path.join(cwd, "tui");
  const jiti = createJiti(path.join(cwd, "package.json"), {
    moduleCache: false,
    jsx: { runtime: "automatic" },
  } as never);
  const modules: (TuiModule & { id: string })[] = [];
  const notices: string[] = [];
  for (const file of files(dir)) {
    const rel = `tui/${file}`;
    let mod: unknown;
    try {
      mod = await jiti.import(path.join(cwd, rel), { default: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProjectError(`tah: failed to load ${rel}: ${message}`);
    }
    const row = mod as Partial<TuiModule> | null;
    if (!row || typeof row !== "object" || typeof row.Component !== "function" || typeof row.slot !== "string") {
      throw new ProjectError(`tah: ${rel} must export default defineTuiModule({ slot, Component })`);
    }
    if (!isSlot(row.slot)) {
      const id = typeof row.id === "string" ? row.id : file.replace(SOURCE, "");
      notices.push(`tui: ${id} declares slot "${row.slot}", which this version does not mount`);
      continue;
    }
    const id = typeof row.id === "string" ? row.id : file.replace(SOURCE, "");
    if (!ID.test(id)) {
      throw new ProjectError(`tah: ${rel}: module id "${id}" is invalid (kebab-case); rename the file or set id`);
    }
    if (modules.some((m) => m.id === id)) {
      throw new ProjectError(`tah: ${rel}: duplicate module id "${id}"`);
    }
    if (!(MOUNTED_SLOTS as readonly string[]).includes(row.slot)) {
      notices.push(`tui: ${id} declares slot "${row.slot}", which this version does not mount`);
      continue;
    }
    modules.push({ ...row, id, slot: row.slot, Component: row.Component });
  }
  return { modules, notices };
}
```

`createJiti` 的 `jsx` 字段若当前 jiti 类型没有，用上面的 `as never`。若运行时报未知选项，查 `node_modules/jiti` 的 `JitiOptions`，改成它实际接受的 JSX 开关，行为不变：`.tsx` 能被 import。

未知 `slot` 与保留插槽共用同一句 notice。坏 id 在跳过保留插槽之前检查，所以 `footer` 模块若 id 非法仍启动失败。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test packages/cli/test/tui-modules.test.ts`

Expected: PASS。

- [ ] **Step 5: Leave the diff uncommitted**

建议信息：`feat(cli): tah chat 加载 tui/ 模块`。

---

### Task 3: 输入框上方的面板、焦点和发送

**Files:**
- Create: `packages/cli/src/tui/panel.tsx`
- Modify: `packages/cli/src/tui/app.tsx`
- Test: `packages/cli/test/tui-modules-ui.test.ts`

**Interfaces:**
- Consumes: `TuiModule & { id: string }`、`TuiCtx`、`panelSend`、`ChatHost.send`、`Transcript` 快照里的 `tokens`、`model`、`todos`、`busy`、`sessionId`
- Produces: `App` 新可选 prop `modules?: (TuiModule & { id: string })[]`。缺省当 `[]`。

`ctx` 填充：

- `cwd` = `App` 已有的 `root`
- `sessionId` = `host.sessionId`
- `busy` = `snap.busy`
- `focused` = 当前焦点 id 等于该模块 id
- `model` = `snap.model`
- `usage` / `sessionUsage`：快照里的本轮与会话用量。读 `packages/cli/src/tui/transcript.ts` 的 `Snapshot`。字段名与 `TokenUsage` 一致就原样放进 `ctx`；快照没有分开的两个对象时，把现有 `snap.tokens` 填到 `usage`，`sessionUsage` 省略
- `todos` = `latestTodos(snap.items) ?? []`，映射成 `{ content, status }`
- `send` = `panelSend(module.id, focused, (text) => host.send(text))`

- [ ] **Step 1: Write the failing test**

`packages/cli/test/tui-modules-ui.test.ts`。Host 至少带上 `App` 现在会读的字段：`skills: []`、`slashPrompts: []`、`permissionMode: "manual"`、`setPermissionMode() {}`，其余同 `packages/cli/test/tui.test.ts` 的 `host`。

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "ink-testing-library";
import { createElement } from "react";
import { Text } from "ink";
import { renderMarkdown } from "../dist/markdown.js";
import { App } from "../dist/tui/app.js";
import { Transcript } from "../dist/tui/transcript.js";
import { defineTuiModule, useTuiInput, type TuiCtx } from "../dist/tui/modules.js";

const host = {
  sessionId: "s1",
  approve: true,
  permissionMode: "manual" as const,
  setPermissionMode() {},
  skills: [],
  slashPrompts: [],
  on: () => () => {},
  send: async () => {},
  continueTurn: async () => {},
  cancel() {},
  answer() {},
  answerQuestion() {},
  skipQuestion() {},
  reset: async () => {},
  resume: async () => {},
  fork: async () => {},
  listSessions: async () => [],
  renameSession: async () => undefined,
  setSessionFlag: async () => {},
  reload: async () => {},
  close: async () => {},
};

test("a read-only above-input module renders above the composer", async () => {
  const transcript = new Transcript(renderMarkdown);
  const modules = [
    defineTuiModule({
      id: "cost",
      slot: "above-input",
      title: "用量",
      Component() {
        return createElement(Text, null, "本轮 3 tokens");
      },
    }),
  ];
  const app = render(createElement(App, { host, transcript, maxSteps: Infinity, color: false, cwd: "/tmp", modules } as never));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    await new Promise((r) => setTimeout(r, 50));
    const frame = app.lastFrame() ?? "";
    assert.match(frame, /用量/);
    assert.match(frame, /本轮 3 tokens/);
    const panelAt = frame.lastIndexOf("用量");
    const inputAt = frame.lastIndexOf(">");
    assert.ok(panelAt >= 0 && inputAt > panelAt);
  } finally {
    app.unmount();
  }
});

test("Ctrl+P focuses an interactive module and Esc returns to the composer", async () => {
  const seen: boolean[] = [];
  const sent: string[] = [];
  const transcript = new Transcript(renderMarkdown);
  const modules = [
    defineTuiModule({
      id: "ask",
      slot: "above-input",
      interactive: true,
      Component({ ctx }: { ctx: TuiCtx }) {
        seen.push(ctx.focused);
        useTuiInput(ctx, (input) => {
          if (input === "g") void ctx.send("go").then(() => undefined, () => undefined);
        });
        return createElement(Text, null, ctx.focused ? "focused" : "idle");
      },
    }),
  ];
  const app = render(
    createElement(App, {
      host: { ...host, send: async (text: string) => { sent.push(text); } },
      transcript,
      maxSteps: Infinity,
      color: false,
      modules,
    } as never),
  );
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    await new Promise((r) => setTimeout(r, 30));
    app.stdin.write("g");
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(sent, []);
    app.stdin.write("\x10"); // Ctrl+P
    await new Promise((r) => setTimeout(r, 30));
    assert.match(app.lastFrame() ?? "", /focused/);
    app.stdin.write("g");
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(sent, ["go"]);
    app.stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 30));
    assert.match(app.lastFrame() ?? "", /idle/);
    assert.ok(seen.includes(true));
  } finally {
    app.unmount();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test packages/cli/test/tui-modules-ui.test.ts`

Expected: FAIL，`App` 不接受 `modules` 或画面没有「用量」。

- [ ] **Step 3: Write minimal implementation**

`packages/cli/src/tui/panel.tsx`：

```tsx
import { Box, Text } from "ink";
import { Component, type ReactNode } from "react";
import type { TuiCtx, TuiModule } from "./modules.js";

const MAX_ROWS = 8;

class PanelBoundary extends Component<{ id: string; children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(err: unknown): { error: string } {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (this.state.error) return <Text color="red">{`tui: ${this.props.id}: ${this.state.error}`}</Text>;
    return this.props.children;
  }
}

export function TuiPanel(props: { module: TuiModule & { id: string }; ctx: TuiCtx }) {
  const { module, ctx } = props;
  const Body = module.Component;
  return (
    <PanelBoundary id={module.id}>
      <Box flexDirection="column" height={MAX_ROWS} overflow="hidden" paddingX={1}>
        {module.title ? <Text dimColor>{module.title}</Text> : null}
        <Body ctx={ctx} />
      </Box>
    </PanelBoundary>
  );
}
```

`app.tsx`：

- `AppProps` 增加 `modules?: (TuiModule & { id: string })[]`。
- state `focusedId: string | undefined`。
- `const panels = (modules ?? []).filter((m) => m.slot === "above-input")`。
- `const interactive = panels.filter((m) => m.interactive)`。
- `chrome` 加上 `panels.length * 8`。
- 在队列 `snap.queue.map` 之后、输入框 `Box` 之前渲染每个 `TuiPanel`。`ctx.send` 用 `panelSend`。`ctx.focused` 为 `focusedId === module.id`。
- 在现有 `useInput` 的最前面（卡片、选择器已经 `return` 的那些分支之后，普通编辑之前）：若 `interactive.length > 0` 且 `key.ctrl && input === "p"`，循环焦点：`undefined` → 第一个 id → … → `undefined`。若 `focusedId` 已设置且 `key.escape`，`setFocusedId(undefined)` 并 `return`（不要清草稿、不要 `host.cancel()`）。若 `focusedId` 已设置，直接 `return`，让模块的 `useTuiInput` 处理其余按键。
- 审批、提问、选择器打开时不进入上述分支（沿用 `accepting`）。

`height={8}` 在子节点只有一行时 Ink 仍可能占 8 行。规格要求返回 `null` 不占行：`Component` 返回 `null` 且没有 `title` 时，`TuiPanel` 返回 `null`，并且该模块不计入 `chrome`。有 `title` 或非 null 子节点时占最多 8 行。实现时不要为了测高度去读布局；UI 测试只断言文字顺序。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test packages/cli/test/tui-modules-ui.test.ts packages/cli/test/tui.test.ts`

Expected: 新测试 PASS。`tui.test.ts` 里不传 `modules` 的用例仍然 PASS。

- [ ] **Step 5: Leave the diff uncommitted**

建议信息：`feat(cli): TUI 在输入框上方挂载模块`。

---

### Task 4: 接到 `tah chat` 并写上约定

**Files:**
- Modify: `packages/cli/src/tui/run.tsx`
- Modify: `docs/design/project-convention.md`
- Modify: `docs/design/tui.md`
- Modify: `docs/superpowers/specs/2026-10-25-tui-modules-design.md`（状态改为实现中的计划链接；代码落地后再改成已实现，本任务先加上计划链接）

**Interfaces:**
- Consumes: `loadTuiModules(flags.cwd)`、`Transcript.note`
- Produces: `runTui` 把 `modules` 传给 `<App modules={...} />`。每条 notice 调用 `transcript.note("[tah] " + notice)`。加载抛 `ProjectError` 时不要挂 TUI，把 `err.message` 打到 stderr 并以非 0 退出（与项目文件加载失败同一风格：看 `packages/cli/src/cli.ts` 里 `ProjectError` 怎么打印，照做）。

- [ ] **Step 1: Wire the loader**

在 `run.tsx` 里 `render(<App ...>)` 之前：

```ts
const loaded = await loadTuiModules(flags.cwd);
for (const notice of loaded.notices) transcript.note(`[tah] ${notice}`);
```

`<App>` 增加 `modules={loaded.modules}`。

`loadTuiModules` 抛错时，调用方还没 `render`。在 `runTui` 里 try/catch：`ProjectError` 则 `console.error(err.message)` 后 `return`。其他错误继续抛。

- [ ] **Step 2: Document the convention**

`docs/design/project-convention.md` 的目录树和「扫描哪些文件」附近加一小节，不要改 `tools/` / `plugins/` 的规则：

- 目录 `tui/`，仅 `tah chat` 的 TUI 加载。
- 默认导出 `defineTuiModule({ slot, Component })`。
- 插槽 `above-input` 会显示；`footer` 与 `transcript` 保留。
- 示例用规格里的 `tui/cost.tsx`（从 CLI 导入 `Box`、`Text`、`defineTuiModule`）。
- 交互模块 `interactive: true`，`Ctrl+P` 聚焦，`useTuiInput` 读键，`ctx.send` 发消息。

`docs/design/tui.md` 加一段：界面模块见 `docs/superpowers/specs/2026-10-25-tui-modules-design.md`，不在 `ChatHost` 上增加方法。

规格文首状态改为：`📐 实现计划：docs/superpowers/plans/2026-10-25-tui-modules.md`。

- [ ] **Step 3: Run the module tests**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --experimental-strip-types --test packages/cli/test/tui-modules.test.ts && node --test packages/cli/test/tui-modules-ui.test.ts`

Expected: PASS。

- [ ] **Step 4: Leave the diff uncommitted**

建议信息：`docs: 写上 tah chat 的 tui/ 模块约定`。
