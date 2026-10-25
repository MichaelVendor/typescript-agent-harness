# TUI Claude 对齐设计（渲染 + 核心交互）

状态：✅ 已实现（计划：[2026-10-25-tui-claude-parity.md](../plans/2026-10-25-tui-claude-parity.md)）

方案：B+A（显式交互模式 + 现有 Ink 上的渲染缺口清单）

## 背景

`tah chat` 的 TUI（Ink 8）已有钉底输入、工具折叠/`Ctrl+O`、批准卡、Shift+Tab 权限模式、斜杠菜单、图片协议、以及 `marked` + `marked-terminal` 的 Markdown。观感已靠向 Claude Code，但交互模式和部分渲染细节仍弱于 Claude 公开文档里的 interactive mode。

本设计在 **不引入全屏 alternate screen / 鼠标** 的前提下，把「渲染能力 + 核心交互」对齐 Claude Code 文档行为。实现用 tah 自己的栈；不复制闭源实现。

## 目标

- 三种互斥键盘模式：`normal` / `transcript` / `history`。
- Markdown 渲染加强：列宽 reflow、语法高亮、OSC 8 链接（终端支持时）、`NO_COLOR` 降级。
- 工具行与批准预览中的 edit/write diff 着色；`transcript` 模式展开工具结果并（有则）标注 model。
- `@` 文件补全（复用 `matchFiles`）、`Ctrl+R` 历史搜索、`Ctrl+G` 外置编辑器、`Ctrl+T` 待办显隐、`Ctrl+S` stash、空输入 `?` 帮助、`Ctrl+L` 重绘。
- 补齐一批 readline 向编辑键（Ctrl+K/U/W/Y，Alt+B/F）。

## 非目标

- 全屏 `/tui fullscreen`、alternate screen、鼠标点选。
- Vim 编辑模式、`!` shell 模式、emoji shortcode `:`。
- `Ctrl+B` 后台任务、双 Esc rewind、子代理相关键、语音。
- Mermaid 画图、LaTeX 公式渲染（Claude TUI 本身也不画图）。
- 改 web UI；本轮只动 `tah chat` TUI。
- 历史搜索持久化到磁盘。

## 架构

继续使用现有 `Transcript` 事件快照 + Ink `App`。不新建渲染包（方案 C 未选）。

| 部分 | 职责 |
| --- | --- |
| `packages/cli/src/markdown.ts` | Markdown 选项：reflow 宽度、高亮、OSC 8 |
| `packages/cli/src/tui/app.tsx` | 模式状态机、快捷键、菜单（`/`、`@`、history）、页脚 hint、stash、todos 显隐 |
| `packages/cli/src/tui/transcript.ts` | 如需给 assistant item 挂上 `model`；其余事件逻辑尽量不动 |
| `packages/cli/src/tui/editor.ts` | readline 向删/移/ yank |
| `packages/cli/src/serve/files.ts` | `matchFiles` 已有；TUI 直接 import，不经 HTTP |
| 小模块（可选） | `prompt-history.ts`、`external-editor.ts`，避免 `app.tsx` 继续膨胀 |

## 模式

| 模式 | 进入 | 退出 | 行为 |
| --- | --- | --- | --- |
| `normal` | 默认 | — | 现有输入、斜杠、批准/提问/会话选择；本设计新增的 `@`、编辑键、stash、`?`、`Ctrl+G/T/S/L` |
| `transcript` | `Ctrl+O` | `Esc` / `q` / 再按 `Ctrl+O` | 工具结果按「展开」规则显示；助手块可带 model dim 标注；PageUp/Down 滚历史；输入框仍显示，但滚动键优先服务 transcript |
| `history` | `Ctrl+R`（仅 normal、无卡） | `Esc` | `bck-i-search:` 过滤本会话用户提示；↑↓ 选、Enter 填入编辑器（不发送） |

批准卡、提问卡、会话选择打开时：不进入 `history`；`Ctrl+O` 仍可切换 transcript 展开（与现「详情」语义兼容）。卡上的 y/a/n、Esc 语义不变。

## 渲染

### Markdown

- 使用 `markedTerminal({ reflowText: true, width: columns })`；`columns` 来自终端宽度（至少 40）。
- 代码块语法高亮保持 `cli-highlight`（marked-terminal 默认）。
- 链接：在 `supports-hyperlinks` / 终端能力允许时走 OSC 8；否则蓝字 + URL 文本。
- 流式：块未闭合前仍显示裸文本；闭合后 `renderMarkdown`（与现一致）。
- `NO_COLOR`、非 TTY、`--plain`：无色、无 OSC 8。

### 工具与 diff

- 默认：一行 `⏺ tool(summary)`；失败始终展开 `⎿`。
- `transcript` 或失败：展开结果；结果长度默认截断（与 `approve.ts` 的 `PREVIEW_LINES` 同量级）；transcript 模式可用更高上限（例如 40 行），仍非无限。
- `edit_file` / `write_file` 批准预览与工具结果中的 `-` / `+` 行着色（`-` dim/红系，`+` cyan），与现 `formatPrompt` 前缀约定一致。

### 消息外观

- 用户：现有 `UserBar`；待发送图片继续文件名列表。用户历史上的附件可显示 `[Image #N]` 编号标注（可选增强，不改附件协议）。
- 助手：`⏺` + Markdown；`transcript` 且有 `model` 时 dim 标注。
- 待办：历史 item 不变；`Ctrl+T` 只控制**状态区**最新 todos 条的显隐。

### 图片

- 协议、占位、SVG/alt、剪贴板 Alt+V：保持现设计（`2026-10-23-tui-images-design.md`）。本轮不改协议选择。

## 交互细节

| 键 | 条件 | 行为 |
| --- | --- | --- |
| `Ctrl+O` | 任意（卡上亦可） | 切换 transcript 展开/模式 |
| `Ctrl+R` | normal、无卡 | 进入 history 搜索 |
| `Ctrl+G` | normal、无卡 | `$VISUAL` 或 `$EDITOR` 编辑当前输入；保存写回；失败 dim 提示 |
| `Ctrl+T` | normal | 切换状态区 todos |
| `Ctrl+S` | normal、无卡 | 有内容 stash+清空；空则 restore（含光标与 pending 图） |
| `?` | normal、输入为空 | 切换帮助块；有字则插入 `?` |
| `Ctrl+L` | 任意 | 强制重绘（不清会话） |
| `@query` | normal、输入中 | `matchFiles(cwd, query)` 列表；↑↓、Tab/Enter 插入相对路径 |
| `/` | 现有 | 与 `@` 互斥，同时只开一个菜单 |

### 编辑键（normal，无菜单抢键时）

已有：`Ctrl+A/E`、方向、Backspace/Delete、Shift|Meta+Enter、`\`+Enter。

新增：`Ctrl+K` 删到行尾、`Ctrl+U` 删到行首、`Ctrl+W` 删到上一空白、`Ctrl+Y` yank；`Alt+B` / `Alt+F` 按词移动。

不改：`Ctrl+C`、`Ctrl+D`、`Esc`、`Alt+V`、`Shift+Tab`、队列 ↑ 取回。

### 历史缓冲

- 每次成功 `send` 的用户原文入内存 ring，上限 200；与 transcript 中 user 文本去重后供 `Ctrl+R`。
- 新会话 / resume 换 id 时清空 ring（resume 后仅用新发送的 + 当前已加载的 user items 重建可选，最小实现：清空后仅新发送）。

## 失败与降级

| 情况 | 表现 |
| --- | --- |
| 无 `$VISUAL`/`$EDITOR` 或进程非 0 | 输入不变；上方 dim `editor unavailable` 或 `editor failed` |
| `matchFiles` 无结果 | 不显示菜单 |
| 终端不支持 OSC 8 | 普通着色链接文本 |
| `NO_COLOR` | 无 ANSI 色、无 OSC 8 |

## 测试

- 模式进入/退出；`Ctrl+R` 过滤与填入；`@` 插入；editor 的 K/U/W/Y。
- `renderMarkdown` 在给定 width 下 reflow；NO_COLOR 路径。
- 外置编辑器用注入的 `openEditor`，不调真编辑器。
- Ink 界面测试沿用现有 `tui.test.ts` 模式（必要时先 build）。

## 文件

| 文件 | 职责 |
| --- | --- |
| `packages/cli/src/markdown.ts` | 渲染选项 |
| `packages/cli/src/tui/app.tsx` | 模式与快捷键 UI |
| `packages/cli/src/tui/editor.ts` | 编辑原语 |
| `packages/cli/src/tui/transcript.ts` | model 等展示字段（若需要） |
| `packages/cli/src/tui/prompt-history.ts` | ring + 过滤（新建） |
| `packages/cli/src/tui/external-editor.ts` | 调编辑器（新建） |
| `packages/cli/test/` | 上列单测与少量 Ink 测 |
