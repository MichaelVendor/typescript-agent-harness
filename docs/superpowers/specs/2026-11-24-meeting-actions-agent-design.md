# Meeting Actions Agent（纪要→行动项）设计

状态：📐 已设计（约定式 example；不改 Runtime API）

系列：WorkBuddy「专家」对标样板 · **B → A → D** 中的 **B（先做）**。  
后续：A `weekly-report-agent`、D `resume-jd-agent`（各自独立 example / spec）。

## 背景

WorkBuddy 用「专家 = 人设 + 方法论 + 工具链」交付可验收办公结果。tah 要对齐的是这种**构造方式**，不是卷 PPT 客户端。

本样板对应高频场景：**会议转写/纪要 → 结构化行动项**，并强制人确认负责人后再落盘——贴合 tah「工具出事实、人签字」与已有 `ask_user`。

## 目标

1. `examples/meeting-actions-agent`：约定式项目，外人可抄目录。
2. 标准路径：贴转写 → 抽取 → 草稿 → `ask_user` 确认 → 落盘 `out/`。
3. `pnpm smoke` 无真模型跑通；`pnpm eval` 断言无证据不填 owner。
4. 最终回复固定四块：结论 · 行动项表 · 待确认 · 缺口。

## 非目标

- 改 `packages/*` 公共 API / DefaultLoop。
- 写入日历、发 IM、Super-agent Ticket、语音转写接入。
- 与周报 / 简历样板合并为单一 example。

## 方案

**约定式单项目（已选）**：`AGENTS.md` + skill `meeting-to-actions` + 专用 tools；对齐 `examples/brief-agent` 的 smoke/eval 习惯。

不选：仅 skill 无专用工具（边界弱）；Room 多角色（过重）。

## 目录

```
examples/meeting-actions-agent/
├── AGENTS.md
├── tah.config.json          # capabilities.coding: true（可选读附件）
├── package.json             # start / smoke / eval / test / typecheck
├── tsconfig.json
├── skills/meeting-to-actions/SKILL.md
├── tools/
│   ├── extract-actions.ts
│   ├── compose-draft.ts
│   ├── confirm-actions.ts
│   └── save-actions.ts
├── lib/                     # schema、normalize、markdown 表
├── data/fixtures/           # 虚构转写（中文为主）
├── scripts/smoke.ts
├── eval/                    # 黄金路径
└── README.md
```

## 铁律（AGENTS.md）

1. 工具出结构，模型只归纳措辞；禁止编造未出现的决议/人名。
2. 缺负责人 → `null` /「待确认」；必须 `ask_user` 或等价确认后再 `save_actions`。
3. `kind` 仅 `decision` | `action` | `info`；不做自动发消息、不建真日历。
4. 最终回复四块：结论 · 行动项表 · 待确认 · 缺口；表用工具返回的 markdown，不重画。

## 流程

```
用户贴转写 / 指向 fixture
  → extract_actions
  → compose_draft
  → ask_user（负责人、优先级；可 skip）
  → confirm_actions
  → save_actions → out/actions/<ts>.{md,json} + out/tasks.jsonl
  → 回复四块
```

Skill `meeting-to-actions` 写死上述顺序；用户也可自然语言触发，由 AGENTS 路由到本 skill。

## 数据

`extract_actions` 产出：

```ts
{
  meetingTitle?: string;
  rows: Array<{
    id: string;
    kind: "decision" | "action" | "info";
    text: string;
    owner: string | null;
    due: string | null;
    priority: "P0" | "P1" | "P2" | null;
    evidence: string;
  }>;
  gaps: string[];
}
```

- `due` / `owner`：仅当原文可指认时填写，否则 `null`。
- `confirm_actions`：合并 `ask_user` 答案（或 smoke 注入的确认），再允许 `save_actions`。
- `save_actions`：拒绝未确认且仍有 `action` 且 `owner == null` 的批次（或要求显式 `allowUnowned: true`——**默认拒绝**，eval 覆盖）。

## 工具职责

| 工具 | 职责 |
| --- | --- |
| `extract_actions` | 输入原文 → schema rows + gaps（实现可规则+轻量启发；eval 用 fixture 确定性） |
| `compose_draft` | rows → 待确认 Markdown |
| `confirm_actions` | 写入确认后的 owner/priority |
| `save_actions` | 落盘 md/json，追加 `tasks.jsonl` |

内置 `ask_user`（`tah chat` / `tah serve`）用于确认；项目 `tools/` 不得再定义同名工具。

## 脚本与验收

| 命令 | 行为 |
| --- | --- |
| `pnpm start` | `tah chat`（可 `--mock`） |
| `pnpm smoke` | fixture → extract→compose→confirm(注入)→save，打印 `ok …/out/actions/…` |
| `pnpm eval` | 黄金：无证据 owner 保持 null；落盘文件存在 |
| `pnpm test` | lib schema / normalize 单测 |

## 文档

- example `README.md`：黄金路径 + 铁律摘要。
- 可选：`docs/guide/getting-started.md` 进阶样板链一句（不改首页 L1 叙事）。

## 后续

用户批准本文 → `writing-plans` → 实现。完成 B 后再开 A / D 的独立 spec。
