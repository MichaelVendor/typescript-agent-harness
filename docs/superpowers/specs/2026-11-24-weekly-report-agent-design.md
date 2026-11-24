# Weekly Report Agent（杂记→周报）设计

状态：📝 设计已批准，待实现

系列：WorkBuddy「专家」对标样板 · **B → A → D** 中的 **A**。  
前序：B `meeting-actions-agent`（已实现）。后续：D `resume-jd-agent`（独立 example / spec）。

## 背景

WorkBuddy 用「专家 = 人设 + 方法论 + 工具链」交付可验收办公结果。tah 对齐这种**构造方式**。

本样板对应高频场景：**本周杂记 → 结构化周报**，并用人选模板（ops 细表 / exec 一页纸）后再落盘——贴合 tah「工具出结构、人签字」与已有 `ask_user`。

## 目标

1. `examples/weekly-report-agent`：约定式项目，外人可抄目录。
2. 标准路径：粘贴杂记 → 抽取归类 → `ask_user` 选模板 → 渲染 → 落盘 `out/reports/`。
3. `pnpm smoke` 无真模型跑通；`pnpm eval` 断言不编造、模板分流正确。
4. 最终回复固定三块：摘要 · 周报正文 · 缺口。

## 非目标

- 改 `packages/*` 公共 API / DefaultLoop。
- 读真 git log、日历、IM；自动发周报。
- 与 meeting-actions / resume-jd 合并为单一 example。
- 代写原文没有的业绩数字、人名、事项。

## 方案

**约定式单项目（已选）**：`AGENTS.md` + skill `notes-to-weekly` + 专用 tools；对齐 `examples/meeting-actions-agent` 的 smoke/eval 习惯。

不选：仅 skill 无专用工具（eval 不稳）；挂在 meeting-actions 旁作第二 skill（样板边界糊）。

## 目录

```
examples/weekly-report-agent/
├── AGENTS.md
├── tah.config.json
├── package.json             # start / smoke / eval / test / typecheck
├── tsconfig.json
├── skills/notes-to-weekly/SKILL.md
├── tools/
│   ├── extract-items.ts
│   ├── compose-draft.ts
│   ├── render-report.ts
│   └── save-report.ts
├── lib/                     # schema、classify、templates
├── data/fixtures/           # 虚构中文杂记
├── scripts/smoke.ts
├── eval/                    # 黄金路径
└── README.md
```

## 铁律（AGENTS.md）

1. 工具出结构，模型只润色措辞；禁止编造原文未出现的事项 / 数字 / 人名。
2. 无法归类 → `section: "unclassified"`，并进入 `gaps`；不进正文主表。
3. 必须先经 `ask_user`（或 smoke 注入）选定 `ops` | `exec`，再 `save_report`。
4. 最终回复三块：摘要 · 周报正文 · 缺口；正文用工具返回的 markdown，不重画。

## 流程

```
用户贴杂记 / 指向 fixture
  → extract_items
  → compose_draft（可选预览，不落盘）
  → ask_user（ops | exec）
  → render_report(template)
  → save_report → out/reports/<ts>.{md,json}
  → 回复三块
```

Skill `notes-to-weekly` 写死上述顺序；用户也可自然语言触发，由 AGENTS 路由到本 skill。

## 数据

`extract_items` 产出：

```ts
{
  periodHint?: string; // 仅当原文可指认时填写
  items: Array<{
    id: string;
    section: "done" | "wip" | "risk" | "next" | "unclassified";
    text: string;
    evidence: string; // 原文摘句；禁止空编
  }>;
  gaps: string[];
}
```

- `periodHint`：仅原文可指认时填写，否则省略。
- `evidence`：必须来自输入摘句；eval 覆盖「无证据不得凭空造条」。
- `save_report`：拒绝未选定 template 的批次（smoke / eval 可注入 `template`）。

## 模板

| 模板 | 形态 |
| --- | --- |
| `ops` | 四段细表（完成 / 进行中 / 风险 / 下周）+ gaps 附录 |
| `exec` | 一页纸：从 done/wip/risk 各取要点合成 3–5 条（不新增事项）+ 「下周」短列表 |

## 工具职责

| 工具 | 职责 |
| --- | --- |
| `extract_items` | 输入杂记 → schema items + gaps（规则+轻量启发；fixture 确定性） |
| `compose_draft` | items → 待选模板前的草稿 Markdown |
| `render_report` | items + `ops`\|`exec` → 定稿 Markdown |
| `save_report` | 落盘 md/json；要求已选 template |

内置 `ask_user`（`tah chat` / `tah serve`）用于选模板；项目 `tools/` 不得再定义同名工具。

## 脚本与验收

| 命令 | 行为 |
| --- | --- |
| `pnpm start` | `tah chat`（可 `--mock`） |
| `pnpm smoke` | fixture → extract→render(注入 ops)→save，打印 `ok …/out/reports/…` |
| `pnpm eval` | 黄金：不出现 fixture 外事项；ops/exec 结构断言；gaps 含 unclassified |
| `pnpm test` | lib schema / classify / template 单测 |

## 文档

- example `README.md`：黄金路径 + 铁律摘要。
- 可选：`docs/guide/getting-started.md` 进阶样板链一句（不改首页 L1 叙事）。

## 后续

用户批准本文 → `writing-plans` → 实现。完成 A 后再开 D 的独立 spec。
