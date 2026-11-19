# brief-agent — 竞品/市场简报 Agent

竞品对照与证据简报 Agent。默认档案是 `data/mock-de.json`（亚马逊德国站小家电/家居：含 B001–B003 与缺价样例 GAP1）。售价是欧元。排名多数为缺数据，工具会标成 `null` /「缺数据」。

**它出简报和证据，不做决策、不下单。**

骨架同构于 `examples/selection-agent`（Skill + 工具取证 + 规则落盘 + 无模型 Eval），交付物是简报而非选品排行榜；独立目录与 `AGENTS.md`，不揉成一个巨 Agent。

无模型回归：`pnpm eval`（用例齐备后进 CI）。

## 跑起来

在仓库根目录：

```bash
pnpm install
pnpm build --filter @typescript-agent-harness/cli...
```

在本目录：

```bash
pnpm start    # tah chat
pnpm smoke    # 不起模型跑完整链路并落盘
pnpm eval     # 无模型黄金路径（需 eval/ 就绪）
pnpm test
pnpm typecheck
```

冒烟会打印 `ok …/out/briefs/<时间戳>.md`，并把 JSON/Markdown 写到 `out/briefs/`。

## 结构

```
AGENTS.md                 角色、铁律、流程、回复四块
skills/competitive-brief/ 路径约束：resolve → fetch → extract → compose → save
tools/
  resolve-targets.ts      → resolve_targets
  fetch-product-pages.ts  → fetch_product_pages
  extract-signals.ts      → extract_signals
  compose-brief.ts        → compose_brief
  save-brief.ts           → save_brief
  signal-*.ts / submit-signals.ts   信号桶与提交（子链路）
plugins/run-log.ts        → project:run-log       out/run-log.jsonl（字段 id）
lib/
  schema.ts               Brief / signals / validateBrief
  targets.ts / fetch.ts / extract.ts / compose.ts / save.ts
scripts/smoke.ts          不起模型跑完整链路（含落盘）
data/mock-de.json         DE mock 档案
```

## 主链路

```
resolve_targets
      │  ≤8 个目标，truncated 声明
      ▼
fetch_product_pages
      │  pages + failures
      ▼
extract_signals
      │  signals + failures
      ▼
compose_brief     ← 规则拼 schema + 四段 markdown
      │
      ▼
save_brief        ← out/briefs/<ts>.{json,md}
```

## 与 selection-agent

| | selection-agent | brief-agent |
| --- | --- | --- |
| 交付物 | 排行榜 / 建议动作 | 对照表 / 差评主题 / 缺口 |
| 落盘 | `out/reports/` | `out/briefs/` |
| run-log 关联字段 | `asin` | `id` |
| Skill | `select-to-shelf` | `competitive-brief` |
