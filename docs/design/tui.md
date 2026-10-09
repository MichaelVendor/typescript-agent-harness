# 设计说明：TUI 与会话接口（v0.24）

状态：✅ 已实现（`v0.24` 分支）；用法见 [CLI](../guide/cli.md)

## 背景

现在的 `tah chat` 是逐行读 stdin 的循环（`packages/cli/src/cli.ts`）：回复流式写到 stdout，审批卡片是一段文字加 `[y/n/a]` 输入，切会话靠 `/resume <n>` 手打序号，粘贴多行会被拆成多轮。

后面还要做 `tah serve`，让 tah-twin 这类 Agent 上网页。参考 DeepSeek Harness（`dsh`）：所有界面都只是同一个核心的前端——`dsh web` 起 host 进程，浏览器通过 RPC + WebSocket 连它；`dsh --profile tui` 用同一套连接层，但在**进程内**直连，不起 HTTP、不占端口。

tah 采用同样的分层：先定义一个与界面无关的**会话接口**，v0.24 的 TUI 在进程内调用它，v0.25 的 `tah serve` 把同一个接口暴露成 HTTP + 事件流。

## 目标

- 在终端里运行 `tah chat` 进入 TUI：输入框、流式 Markdown 回复、工具调用行、界面内审批、状态栏、斜杠命令菜单、会话选择器、多行输入。
- 会话接口 `ChatHost` 的命令和事件都是纯 JSON，v0.25 可以原样搬到 HTTP 上。

## 非目标

- 不做 `tah serve`、网页（v0.25）。
- 不做输入历史（↑ 调出上一条）、鼠标、主题。
- 不改 `core` / `agent` / `tools` 等包，改动只在 `packages/cli`。
- 不改逐行模式的行为：管道、CI、`--plain` 继续走现有循环。
- 不把 `ChatHost` 拆成独立包；等 v0.25 或第三方真要复用时再拆。

## 入口

| 情况 | 走哪条路 |
| --- | --- |
| `tah chat`，stdin 和 stdout 都是终端 | TUI |
| `tah chat --plain` | 现有逐行模式 |
| stdin 或 stdout 不是终端（管道、CI、重定向） | 现有逐行模式 |
| `tah run` | 不变 |

启动前的错误（没有 API key、项目文件出错）在挂载 TUI 之前抛出，打印方式和现在一样。

## 会话接口 `ChatHost`

```ts
type HistoryItem =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; callId: string; tool: string; summary: string; ok: boolean };

type HostEvent =
  | { type: "session"; id: string; resumed: boolean; history: HistoryItem[]; hiddenTurns: number }
  | { type: "text"; delta: string }
  | { type: "tool.start"; callId: string; tool: string; summary: string }
  | { type: "tool.end"; callId: string; ok: boolean; result: string }
  | { type: "approval"; id: string; tool: string; input: unknown }
  | { type: "notice"; text: string }
  | { type: "turn.end"; state: string; finishReason: string; rounds: number }
  | { type: "turn.error"; cancelled: boolean; message: string };

interface ChatHost {
  readonly sessionId: string;
  on(listener: (event: HostEvent) => void): () => void;
  send(text: string): Promise<void>;
  continueTurn(): Promise<void>;
  cancel(): void;
  answer(id: string, answer: "yes" | "always" | "no"): void;
  reset(): Promise<void>;
  resume(ref: string): Promise<void>;
  fork(turns?: number): Promise<void>;
  listSessions(): Promise<SessionRow[]>;
  close(): Promise<void>;
}

function createChatHost(flags: CliFlags): Promise<ChatHost>;
```

规则：

- **同一时间只跑一轮。** 一轮进行中再调 `send` / `continueTurn` / `reset` / `resume` / `fork` 直接抛错；界面负责在进行中禁用这些操作。
- **`send` 的结果全走事件。** 一轮正常结束发 `turn.end`；失败或被取消发 `turn.error`，`send` 本身不 reject（只有上一条的误用会抛）。
- **审批变成事件。** 审批插件的 `ask(call, signal)` 发出 `approval` 事件，等 `answer(id, …)`。`cancel()` 或这一轮被中止时，未回答的审批按 `no` 处理，和现在一致。`--yes` 时不发审批事件。
- **步数上限。** `turn.end` 的 `finishReason` 为 `max_steps` 时，界面问是否继续，继续就调 `continueTurn()`（对应 `session.resume()`）。
- **会话切换。** `reset` / `resume` / `fork` 和打开时都会发一条 `session` 事件。`history` 只带最近 3 轮，更早的轮数放在 `hiddenTurns`。
- **`notice`** 承接现在打印成灰色日志的内容：LLM 重试、上下文裁剪、项目加载结果、启动参数行（`--quiet` 时不发）。
- **事件全是纯 JSON。** 测试里对每个事件做 `JSON.parse(JSON.stringify(e))` 应深相等。`tool.start.summary` 和 `tool.end.result` 由 host 预先生成字符串，界面不需要理解各工具的参数。
- **工具事件的归属。** 运行时的 `tool.started` / `tool.finished` 不带 sessionId。TUI 同一时间只有一个会话，所以 v0.24 不处理；v0.25 一个服务跑多个会话时要补上。

### 工具摘要

| 工具 | `summary` | `result`（成功 / 失败） |
| --- | --- | --- |
| `read_file` / `write_file` / `list_files` | 路径 | 行数或条目数 / 错误信息 |
| `grep` | 模式（和路径） | 匹配数 / 错误信息 |
| `execute_command` | 命令行 | 退出码 / 错误信息 |
| 其他（项目工具、MCP 工具） | 参数 JSON，截到 60 字符 | `done` / 错误信息 |

### `bootRuntime` 的拆分

现在 `bootRuntime` 既组装插件，又直接往 stdout 写（Markdown 流、`[tah]` / `[llm]` / `[tool]` 日志）。给它加一个选项，关掉 stdout 输出；host 自己订阅同一批运行时事件（`agent.assistant-stream`、`tool.started`、`tool.finished`、`tool.failed`、`llm.retry`、`agent.context.trimmed`），转成 `HostEvent`。逐行模式不传这个选项，行为不变。

## 界面

内联模式（像 Claude Code），不切备用屏（不像 vim / OpenCode）。写完的内容通过 Ink 的 `<Static>` 进入终端自己的滚动区，鼠标滚动、复制、搜索都照常；Ink 只重绘底部一小块实时区域，避免高区域重绘的闪烁。

```text
── 滚动区（已完成，只打印一次）───────────────────────────────
[tah] session_31 · resumed · showing last 3 of 8 turns
› 帮我看下 auth 模块
⏺ read_file  src/auth.ts                                ✓ 120 lines
回复按 Markdown 渲染（流式中按块渲染）…
── 实时区（Ink 不断重绘）────────────────────────────────────
⏺ execute_command  npm test                             ⠋ running
╭─ Run command ──────────────────────────────────────────╮
│ $ npm test                                             │
╰─ y allow once · a always allow · n reject ─────────────╯
╭────────────────────────────────────────────────────────╮
│ > 输入框（多行）                                        │
╰────────────────────────────────────────────────────────╯
 deepseek · session_31 · 3 rounds · approve=on     Enter send · Alt+Enter newline · Ctrl+C stop
```

### 操作

| 操作 | 行为 |
| --- | --- |
| Enter | 发送（输入为空时忽略） |
| 换行 | Option/Alt+Enter，或行尾 `\` 再 Enter；支持 Kitty 键盘协议的终端（Kitty、Ghostty、WezTerm 等）里 Shift+Enter 也行 |
| 粘贴 | `usePaste` 收整段文本，原样进输入框，不会中途发送 |
| 编辑 | ←→↑↓ 移动光标（↑↓ 在多行之间移动）、Home/End、Ctrl+A/E、Backspace；中文等宽字符按显示宽度对齐 |
| 行首输入 `/` | 弹出命令菜单，按输入过滤；↑↓ 选，Tab 补全，Enter 补全并执行（不需要参数的命令） |
| `/resume`（不带参数）或 `/sessions` | 打开会话列表，↑↓ 选、Enter 切换、Esc 返回；`/resume <id\|n>` 照旧直接切 |
| `/reset`、`/fork [n]`、`/exit` | 和逐行模式相同 |
| 审批卡片出现时 | 按 y / a / n 立即生效，不用回车；Ctrl+C 拒绝并停止本轮 |
| 步数上限 | 提示行：Enter 继续同一轮，n 停下 |
| Ctrl+C | 回复中：停止本轮；空闲且有输入：清空输入；空闲且为空：退出 |
| Ctrl+D | 空闲且输入为空时退出 |

### 渲染

- **回复：** 复用 `markdown.ts` 的按块渲染（`marked-terminal`）。每个写完的块移进滚动区，实时区只留正在写的那一块的原文。
- **工具行：** `⏺ 工具名  摘要`，运行中显示转圈，结束后变成 `✓ 结果` 或 `✗ 错误`，然后移进滚动区。
- **用户消息：** 以 `› ` 开头写进滚动区，多行原样保留。
- **notice / 错误：** 灰色 / 红色一行，进滚动区。
- **退出时：** 和逐行模式一样提示 `session … saved — continue with: tah chat --session …`。

## 文件

| 文件 | 改动 |
| --- | --- |
| `packages/cli/src/host.ts`（新） | `createChatHost`、`HostEvent` 等类型、运行时事件转换、历史生成、工具摘要 |
| `packages/cli/src/runtime.ts` | `bootRuntime` 增加关闭 stdout 输出的选项；逐行模式不变 |
| `packages/cli/src/tui/editor.ts`（新） | 多行输入框的纯函数：插入、换行、删除、光标移动、显示宽度 |
| `packages/cli/src/tui/*.tsx`（新） | Ink 组件：根组件、输入框、命令菜单、会话选择器、工具行、审批卡片、状态栏 |
| `packages/cli/src/cli.ts` | `chat`：终端且没有 `--plain` 时启动 TUI |
| `packages/cli/src/args.ts` | `--plain`；用法说明 |
| `packages/cli/package.json` | 依赖 `ink@^8`、`react@^19.3`；开发依赖 `@types/react`、组件测试库 |
| `packages/cli/tsconfig.json` | 开启 `jsx: react-jsx` |
| `docs/guide/cli.md`、`CHANGELOG.md`、README | 用法说明 |

## 错误处理

| 情况 | 表现 |
| --- | --- |
| 启动前出错（没有 key、项目文件错误） | 不挂载 TUI，打印方式同现在，退出码 1 |
| 一轮失败 | 红色一行 `turn failed: …`，历史保留，可以继续聊 |
| 一轮被取消 | 灰色一行 `turn cancelled — history kept` |
| `/resume` 找不到会话、`--no-persist` 下用 `/sessions` | 红色一行，留在当前会话 |
| 渲染时抛异常 | 先卸载 Ink、恢复终端模式，再打印错误，退出码 1 |

## 测试

- `host.test.ts`（mock 模型）：
  - 一轮带工具调用（mock 模型会先调 `list_files` 再回复）：事件顺序 `tool.start` → `tool.end` → `text` … → `turn.end`；
  - 审批（同 `approve.test.ts`，直接经 `TOOLS.execute` 触发 `write_file`）：发出 `approval` 事件，`answer(yes)` 后文件写入，`answer(no)` 后不写；审批挂起时 `cancel()` 按 `no` 处理；
  - `reset` / `resume` / `fork` 各发一条 `session`，`history` 最多 3 轮；
  - 一轮进行中再 `send` 抛错；
  - 所有事件经 `JSON.stringify` 往返后不变。
- `editor.test.ts`：中文插入与光标宽度、换行、跨行删除、粘贴多行、行首 `/` 识别。
- 组件测试（`ink-testing-library`，先确认它兼容 Ink 8，不兼容就直接断言 `render` 输出）：命令菜单过滤与补全、审批卡片按键、会话选择器、Ctrl+C 三种状态。
- 逐行模式的现有测试全部保持通过。
- 手动验证（真实 DeepSeek）：工具行、审批、Ctrl+C、多行粘贴、会话切换。中文输入法需要在你的终端里试一遍。

## 已定决策

| 问题 | 决定 |
| --- | --- |
| 架构 | 会话接口 + 前端；TUI 进程内直连（同 `dsh`），v0.25 的 `tah serve` 暴露同一接口 |
| 顺序 | v0.24 接口 + TUI，v0.25 `tah serve` |
| 渲染库 | Ink 8（React） |
| 入口 | 终端里 `tah chat` 直接进 TUI；非终端和 `--plain` 走逐行模式 |
| 第一版范围 | 流式消息、工具行、界面内审批、状态栏 + Ctrl+C + 斜杠命令、命令补全菜单、会话选择器、多行输入 |
| 代码位置 | 全放 `packages/cli` |
| 显示方式 | 内联 + `<Static>`，不用备用屏 |
| 分支 | `main` 停在 `v0.23.1`，在 `v0.24` 开发 |
