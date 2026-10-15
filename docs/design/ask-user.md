# 设计说明：让用户选择（`ask_user`）

状态：✅ 已实现（v0.37）

需求含糊、或者有几种都说得通的做法时，Agent 以前要么自己猜，要么在回复里用一段文字反问，用户还得打字回答。本设计参照 Claude Code 的 AskUserQuestion：模型调用 `ask_user` 工具，一次问 1–4 个选择题，用户点选项（或自己输入）后，答案作为工具结果回到模型，这一轮接着往下做。

遵循的原则（见 [设计哲学](../guide/philosophy.md)、[`tah serve`](./serve.md)）：

- 提问的界面属于 Application 层：工具、事件、提示词都在 `packages/cli`，界面在 `packages/web` 和 TUI；`core` / `agent` / `tools` / `llm` 不改。
- 和审批走同一条路：host 发事件、等回答；界面状态只由事件重建（刷新页面、新开标签页能看到还没回答的问题）。
- 只有有人能回答的前端才挂这个工具：`tah serve` 和 `tah chat`（TUI）。`tah run`、`tah chat --plain` 没有 host，不挂，提示词里也不提。
- 和审批无关：`--yes` 关掉审批，但不关提问。

## 工具

```ts
ask_user({
  questions: [            // 1–4 个，一张卡片里一起回答
    { question: string; options: string[] /* 2–5 个 */; multiple?: boolean },
  ],
})
// → { answers: [{ question, answer: string[] }] }   每题：选中的选项和 / 或用户自己输入的文字
// → { skipped: true, note }                         用户点了跳过
```

- 参数不合规（题目为空、选项少于 2 个或多于 5 个、超过 4 题）直接报工具错误，模型可以改了再问。核心的 `JSONSchema` 类型没有 `minItems`，个数限制写在描述里、执行时检查。
- 每题都可以不选选项、自己输入；单选题选了选项就清掉输入，输入了就清掉选项；多选题两者可以同时有。
- 这一轮被停止（Stop / Ctrl+C）时，没回答的问题直接作废，工具调用失败。
- **跳过**（网页 Skip、终端 Esc）：工具正常返回 `{ skipped: true, note }`，结果照常写进历史；host 随即停掉这一轮，不再调模型，对外发 `turn.end`（不是"已取消"）。这些问题以 Markdown 文字列在对话里（问题加粗、选项列成列表），用户看完直接打字回复，模型下一轮从 `note` 知道问题被跳过了。文字由工具调用的参数生成，重建历史时同样显示。核心的 Agent 循环没有"工具结束本轮"的机制，所以结束这一轮由 host 用停止实现，`core` / `agent` 不改。
- 项目 `tools/` 里不能再定义叫 `ask_user` 的工具（和 `skill` 一样是保留名）。

提示词（挂了工具时才加）：需求含糊或有几种做法时，先用 `ask_user` 问（题目简短，2–5 个具体选项，推荐的放第一个），不要猜，也不要用纯文字反问；需求清楚就直接做。

## 事件和接口

| | 内容 |
| --- | --- |
| host 事件 `question` | `{ id, questions }`：卡片出现 |
| host 事件 `question.end` | `{ id }`：回答了或作废了，所有前端收起卡片 |
| `ChatHost.answerQuestion(id, answers)` | `answers` 每题一个字符串数组，顺序同 `questions` |
| `ChatHost.skipQuestion(id)` | 跳过：问题变成文字，这一轮结束 |
| `POST /api/question` | `{ id, answers: string[][] }` 或 `{ id, skip: true }`，格式不对 400，成功 204 |

`question.end` 之后，hub 回放这一轮时去掉这张卡片，新开的标签页不会再看到已回答的问题。对话里保留一行工具记录：`ask_user  第一个问题 (+N)  ✓ 答案1 · 答案2`。

## 网页

- 卡片出现在审批卡片的位置（消息列表底部），参照 Cursor：一次只显示一道题，多道题时右上角 `‹ 1 / 3 ›` 左右切换，已选的答案切换后保留。选项竖排、带编号，下面一个"Or type your own answer"输入框；多选题标"pick any"。
- 单选题点了选项自动跳到下一题；只有一道单选题时直接提交。底部左边 **Skip**，右边 **Next**（最后一题是 **Submit**）；当前题有答案才能点，Submit 时还有没答的题就先跳到那一题。输入框里回车等于点 Next / Submit。
- 等待回答时不显示"thinking…"；侧栏当前会话显示橙点和"needs answer"（审批时仍是"needs approval"）。

## 终端（`tah chat`）

- 输入框上方显示当前这道题和编号选项，多道题一道一道答（`(1/3)`）。
- 单选：按数字直接选；多选：按数字勾选 / 取消，回车确认。
- 自己的回答直接在输入框里打字，回车提交（多选题会和勾选的选项一起提交）。输入框里有字时，数字键当作输入。
- Esc 跳过（问题以文字列出，这一轮结束）；Ctrl+C 停止这一轮，问题作废。

## 非目标

- 选项带说明文字、预览（Claude Code 有，先不做）。
- 回答后修改答案。
- 在 `tah run` 里问（没人回答）。
