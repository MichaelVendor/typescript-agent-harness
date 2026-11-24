# Resume × JD Agent（简历×JD 匹配）设计

状态：✅ 已实现

系列：WorkBuddy「专家」对标样板 · **B → A → D** 中的 **D**。  
前序：B `meeting-actions-agent`、A `weekly-report-agent`（已实现）。

## 背景

WorkBuddy 用「专家 = 人设 + 方法论 + 工具链」交付可验收办公结果。tah 对齐这种**构造方式**。

本样板对应高频场景：**简历 + JD → 结构化匹配表**，并用人确认是否生成「基于已有证据的改写建议」后再落盘——贴合 tah「工具出结构、人签字」与已有 `ask_user`。

## 目标

1. `examples/resume-jd-agent`：约定式项目，外人可抄目录。
2. 标准路径：粘贴简历+JD → 解析 → 匹配 → `ask_user`（是否改写）→（可选）改写 → 落盘 `out/match/`。
3. `pnpm smoke` 无真模型跑通；`pnpm eval` 断言不编造、无证据不进 rewrites。
4. 最终回复：匹配摘要 · 匹配表 ·（可选）改写 · 缺口。

## 非目标

- 改 `packages/*` 公共 API / DefaultLoop。
- 真投递、LinkedIn、ATS API、封面信。
- 与 meeting-actions / weekly-report 合并为单一 example。
- 编造未出现的经历、技能或数字。

## 方案

**约定式单项目（已选）**：`AGENTS.md` + skill `resume-jd-match` + 专用 tools；对齐 `examples/weekly-report-agent` / `meeting-actions-agent` 的 smoke/eval 习惯。

不选：仅 skill 无专用工具（eval 不稳）；挂在其他 example 旁作第二 skill（样板边界糊）。

## 目录

```
examples/resume-jd-agent/
├── AGENTS.md
├── tah.config.json
├── package.json             # start / smoke / eval / test / typecheck
├── tsconfig.json
├── skills/resume-jd-match/SKILL.md
├── tools/
│   ├── parse-pair.ts
│   ├── match-requirements.ts
│   ├── compose-rewrites.ts
│   └── save-report.ts
├── lib/                     # schema、parse、match、rewrite、save
├── data/fixtures/           # 虚构中文简历 + JD
├── scripts/smoke.ts
├── eval/                    # 黄金路径
└── README.md
```

## 铁律（AGENTS.md）

1. 工具出结构，模型只润色措辞；禁止编造原文未出现的经历 / 技能 / 数字。
2. `status: "missing"` 且 `evidence == null` → 只进 `gaps`，**不得**进入 `compose_rewrites`。
3. 必须先经 `ask_user`（或 smoke 注入）选定是否包含改写（`includeRewrites: boolean`），再 `save_report`。
4. 最终回复：匹配摘要 · 匹配表 ·（可选）改写 · 缺口；表与改写用工具返回的 markdown，不重画。

## 流程

```
用户贴简历+JD / 指向 fixture
  → parse_pair
  → match_requirements
  → ask_user（yes|no：是否生成改写建议）
  → [yes] compose_rewrites
  → save_report → out/match/<ts>.{md,json}
  → 回复四块（无改写时第三块写「已跳过」）
```

Skill `resume-jd-match` 写死上述顺序；用户也可自然语言触发，由 AGENTS 路由到本 skill。

## 数据

`parse_pair` 产出：

```ts
{
  resumeBullets: string[];
  jdRequirements: Array<{
    id: string;
    text: string;
    priority: "must" | "nice";
  }>;
}
```

`match_requirements` 产出：

```ts
{
  rows: Array<{
    id: string;
    priority: "must" | "nice";
    requirement: string;
    status: "met" | "partial" | "missing";
    evidence: string | null;
  }>;
  gaps: string[];
}
```

`compose_rewrites` 产出（仅 `status !== "met"` 且 `evidence != null`）：

```ts
{
  rewrites: Array<{
    reqId: string;
    before: string;
    after: string;
    evidence: string;
  }>;
}
```

- `evidence`：必须来自简历摘句；`missing` 默认为 `null`。
- `save_report`：拒绝未选定 `includeRewrites` 的批次（smoke / eval 可注入）。

## 工具职责

| 工具 | 职责 |
| --- | --- |
| `parse_pair` | 输入简历+JD 原文 → bullets + requirements（规则+轻量启发；fixture 确定性） |
| `match_requirements` | 对齐 → rows + gaps |
| `compose_rewrites` | 有证据的 gap/partial → 改写建议；无证据拒绝造条 |
| `save_report` | 落盘 md/json；要求已选 `includeRewrites` |

内置 `ask_user`（`tah chat` / `tah serve`）用于确认是否改写；项目 `tools/` 不得再定义同名工具。`save_report` **不**向模型暴露任意 `outDir`（仅 lib/测试可用）。

## 脚本与验收

| 命令 | 行为 |
| --- | --- |
| `pnpm start` | `tah chat`（可 `--mock`） |
| `pnpm smoke` | fixture → parse→match→rewrites(注入 yes)→save，打印 `ok …/out/match/…` |
| `pnpm eval` | 黄金：无证据不进 rewrites；匹配含 must/nice；落盘存在；validate 拒空 evidence |
| `pnpm test` | lib schema / match / rewrite 单测 |

## 文档

- example `README.md`：黄金路径 + 铁律摘要。
- 可选：`docs/guide/getting-started.md` 进阶样板链一句（不改首页 L1 叙事）。

## 后续

用户批准本文 → `writing-plans` → 实现。系列 B→A→D 完成后收口。
