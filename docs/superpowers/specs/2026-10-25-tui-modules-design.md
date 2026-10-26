# TUI 模块扩展设计

状态：📐 实现计划：docs/superpowers/plans/2026-10-25-tui-modules.md

## 背景

`tah chat` 的 TUI 是 Ink。输入框上方的信息（待办、帮助、队列、审批）都写在 `packages/cli/src/tui/app.tsx` 里。项目能通过 `tools/`、`plugins/` 扩展 Agent，不能扩展这块界面。

本设计加一条只在 TUI 里生效的约定：`tui/` 下的 TSX 模块，按**插槽**挂到界面上。第一版只实现插槽 `above-input`（输入框正上方的信息面板）。插槽名字先留出来，以后加状态行、对话行等位置时不改加载方式和 `ctx` 的形状。

已定：

- 模块是 TSX 组件，宿主注入 `ctx`。
- `ctx.send(text)` 走 `ChatHost.send`，和输入框同一条路径。
- 只有获得焦点的交互模块可以 `send`。

## 目标

- 项目模式（`package.json` 依赖 `@typescript-agent-harness/cli`）下，`tah chat` 加载 `tui/` 里的模块。
- 模块声明 `slot`。`above-input` 画在输入框上方，按文件名顺序叠放。
- `ctx` 是只读会话快照，外加 `send`。
- 交互模块用 `Ctrl+P` 轮流获得焦点；`Esc` 回到输入框。未聚焦时 `send` 抛错。
- 单个模块抛错或超高时，只影响那一块。

## 非目标

- 不挂到 `tah serve` 网页、`tah run`、`--plain`、非 TTY。
- 不把现有待办条、审批卡、斜杠菜单改成模块。
- 不实现 `footer`、`transcript` 插槽（只识别名字并跳过）。
- 不把 `tui/` 纳入热更新；改模块需重启 `tah chat`。
- 不提供 `cancel`、`reset`、`compact`、附件、审批回答。模块不能拿到整个 `ChatHost`。
- 不在 `plugins/` 里混装界面。`plugins/` 仍是运行时插件，无头进程也会加载。

## 插槽

| `slot` | 这一版 | 位置 |
| --- | --- | --- |
| `above-input` | 挂载 | 队列行之下、圆角输入框之上 |
| `footer` | 跳过，启动时一行 notice | 预留给输入框下的状态行 |
| `transcript` | 跳过，启动时一行 notice | 预留给对话区里的自定义行 |

未知 `slot` 与保留插槽相同：notice 写明未挂载，进程继续启动。这样作者可以先把分类写上，等对应界面落地后再显示。

## 文件约定

与 `tools/`、`plugins/` 同一套项目模式开关和扫描规则（见 [约定式项目](../../design/project-convention.md)）：

| 规则 | 说明 |
| --- | --- |
| 目录 | `<cwd>/tui/`，不存在则跳过 |
| 只扫第一层 | `.ts`、`.tsx`、`.js`、`.jsx`、`.mts`、`.mjs` |
| 跳过 | `_` 开头、`.d.ts`、`*.test.*`、`*.spec.*` |
| 顺序 | 文件名字典序 |
| 谁加载 | 仅 `tah chat` 且走 TUI。`loadProject` 不读这个目录 |

默认导出 `defineTuiModule({...})` 的返回值。形状不对时启动失败，报错带相对路径，和其他约定文件一样。

`id` 默认是去掉扩展名的文件名，必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。同一项目里 `id` 重复则启动失败。显式 `id` 覆盖文件名。

## API

CLI 再导出 Ink 的 `Text` 和 `Box`，作者只依赖 `@typescript-agent-harness/cli`，不必自己装 `react` / `ink`。

```tsx
// tui/cost.tsx
import { Box, Text, defineTuiModule } from "@typescript-agent-harness/cli";

export default defineTuiModule({
  slot: "above-input",
  title: "用量",
  Component({ ctx }) {
    const n = ctx.sessionUsage?.totalTokens ?? 0;
    return (
      <Box>
        <Text>会话 {n} tokens · {ctx.model ?? "无模型"}</Text>
      </Box>
    );
  },
});
```

```ts
type TuiSlot = "above-input" | "footer" | "transcript";

type TuiModule = {
  id?: string;
  slot: TuiSlot;
  /** 有则宿主画一行暗色标题，计入高度上限。 */
  title?: string;
  /**
   * 默认 false。true 时 Ctrl+P 可以聚焦。
   * 聚焦期间按键交给模块，输入框不接收。
   */
  interactive?: boolean;
  Component(props: { ctx: TuiCtx }): React.ReactNode;
};

type TuiCtx = {
  cwd: string;
  sessionId: string;
  busy: boolean;
  focused: boolean;
  model?: string;
  /** 本轮用量。当前 Transcript 快照只存会话累计，所以这一版不填。 */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 会话累计用量。 */
  sessionUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  todos: { content: string; status: string }[];
  /**
   * 与输入框相同的 `ChatHost.send`。
   * 忙时排队；`/name`、审批、对话记录都走原路径。
   * 本模块未聚焦时抛错，避免在渲染里误发。
   */
  send(text: string): Promise<void>;
};
```

`defineTuiModule` 是带类型的恒等函数，和 `defineTool` 一样。

交互模块用 `useTuiInput(ctx, handler)` 读键。它包着 Ink 的 `useInput`，只在 `ctx.focused` 为真时激活，并且不把 `Esc`、`Ctrl+P` 交给 handler。聚焦期间粘贴也不进输入框。`Esc` 由宿主处理，不交给模块：只把焦点还给输入框，不清空草稿，也不取消正在跑的一轮。`Ctrl+P` 在已聚焦时切到下一个交互模块，最后一个之后回到输入框。没有 `interactive: true` 的模块时，`Ctrl+P` 保持今天的行为（不占用）。

`ctx` 每帧由 TUI 从现有 `Transcript` 快照和 `ChatHost` 填好。模块不要把 `ctx` 存进自己的长期状态；下一帧会换新对象。

## 布局与失败

- 每个 `above-input` 模块外包一层，最多 **8** 行，超出裁掉，标题占其中一行。
- 返回 `null` 的模块不占行。
- 渲染抛错：该块换成一行 `tui: <id>: <message>`，其余模块和输入框继续。错误不往上冒。
- 这些行计入 `app.tsx` 里现有的 `chrome` 高度，对话区相应变矮。
- 顺序：帮助 / 待办 / 菜单 / 队列之后，输入框之前。审批卡和提问卡仍在更上面，聚焦期间不把按键交给模块（和现在「卡片占键盘」一致）。

## 加载

`runTui` 在 `createChatHost` 之后调用 `loadTuiModules(cwd)`。不是项目则得到空列表。保留插槽和未知插槽的模块不进入列表，改为 `transcript.note` 一条 notice。

`send` 的实现是闭包：`focusedId === module.id` 时调用 `host.send(text)`，否则抛 `tui: <id> is not focused`。空字符串沿用 host 现有的 “message is empty”。

## 测试

- 加载器：排序、`id` 冲突、坏导出、保留插槽被滤掉、非项目返回空。
- `send`：未聚焦抛错；聚焦后调用传入的 `host.send`。
- Ink：一个只读模块出现在输入框上方；一个交互模块在 `Ctrl+P` 后 `focused === true`，`Esc` 后回到输入框。用现有的 `ink-testing-library`。

## 以后加插槽时要动的地方

1. `TuiSlot` 加上新名字。
2. `app.tsx` 在对应位置渲染该插槽的列表。
3. 若新位置要键盘，沿用同一套焦点：同一时刻只有一个模块或输入框持有按键。

`ctx` 只增字段，不改 `send` 的语义。
