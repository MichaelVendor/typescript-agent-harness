# selection-agent — 跨境电商选品 Agent

选品分析与排序 Agent。默认候选池是 `data/DE2610221.json`（亚马逊德国站档案：3 个竞品、关键词备注），再加上 `data/de-search.json`（四个德国站搜索页快照：标题、欧元价、评分、评论数）。
售价是欧元。采购成本、12 个月搜索序列和专利检索两边都没有，工具会标成缺数据。
`SELECTION_SOURCE=mock` 仍走本地样例，`SELECTION_SOURCE=amazon` 才抓美国站搜索页。数据源接口在 `lib/sources/types.ts`。

**它出排行榜和证据，不做决策。**

## 跑起来

在仓库根目录：

```bash
node /usr/local/lib/node_modules/corepack/dist/pnpm.js install   # 首次
node /usr/local/lib/node_modules/corepack/dist/pnpm.js build --filter @typescript-agent-harness/cli...   # 首次 / 改过 packages

examples/selection-agent/scripts/chat.sh                # 恢复最近一次会话
examples/selection-agent/scripts/chat.sh --session 2    # 指定会话
examples/selection-agent/scripts/chat.sh --mock         # 不调模型，只验证接线
```

`scripts/chat.sh` 只是绕开 PATH 里没有 `node` 的机器（`tah` 的 bin shim 需要它）；
PATH 正常时 `pnpm start` 等价。API key 来自 `.env` / `~/.tah/settings.json`。

冒烟（不需要模型、不需要 API key）：

```bash
node --experimental-strip-types examples/selection-agent/scripts/smoke.ts
node --experimental-strip-types examples/selection-agent/scripts/smoke-orchestration.ts
node --test --experimental-strip-types examples/selection-agent/lib/*.test.ts
```

冒烟会打印 12 个 mock 候选的排行榜，并把完整报告写到 `out/reports/<时间戳>.json`。
编排冒烟用假子 Agent（不调模型），额外验证切批、并发上限、失败单列。

## 结构

```
AGENTS.md              角色、铁律、流程、归一化换算表
tools/                 文件名即工具名
  search-products.ts   → search_products      候选池
  research-candidates.ts → research_candidates 按候选并行派子 Agent 取证
  score-and-save.ts    → score_and_save       校验→算分→排序→落盘（主链路）
  keyword-metrics.ts   → keyword_metrics      需求 / 趋势（子 Agent 调用）
  competitor-snapshot.ts → competitor_snapshot 竞争格局（子 Agent 调用）
  landed-cost.ts       → landed_cost          成本 / 利润（子 Agent 调用）
  compliance-check.ts  → compliance_check      合规风险（子 Agent 调用）
  score-candidates.ts  → score_candidates      只打分，单候选手工复核用
  save-report.ts       → save_report           只落盘，单候选手工复核用
plugins/run-log.ts     → project:run-log       工具调用日志 out/run-log.jsonl
lib/
  schema.ts            候选字段 + 手写校验（无外部依赖）
  score.ts             权重、封顶、置信度、动作、排序、markdown
  normalize.ts         原始指标 → 0–1 打分输入（分段插值）
  subagent.ts          切批、有界并发、任务书、子 Agent 回复解析（纯函数）
  research.ts          起子 Agent：每批 N 个 run_subagent 并行，只收 JSON
  report.ts            报告构建与落盘
  sources/types.ts     MarketSource 接口（换数据源只改实现）
  sources/mock.ts      本地 mock 数据
scripts/smoke.ts       不起模型跑完整链路（含落盘）
scripts/smoke-orchestration.ts  假子 Agent 跑编排链路（不起模型、不落盘）
```

## 编排：一个候选一个子 Agent

主 Agent 不再逐个 asin 自己查四个工具。`research_candidates` 把候选切开，每批起 N 个
`run_subagent`（默认 3，上限 8），子 Agent 自己调四件套再回 JSON：

```
search_products
      │  12 个候选
      ▼
research_candidates(concurrency=3)
      ├─ 批次 1 ─ [子 Agent A | 子 Agent B | 子 Agent C]  ← 并发
      ├─ 批次 2 ─ [子 Agent D | 子 Agent E | 子 Agent F]  ← 批次间串行，限流阀门
      └─ …
      │  每个候选：metrics / 区间 / evidence / riskFlags（+ failures）
      ▼
score_and_save     ← 一次调用：校验 → lib/score.ts → 排序 → out/reports/*.json
      │
      ▼
主 Agent 只负责写"为什么"和"下一步验什么"
```

为什么这么切：

- **上下文**：子 Agent 各自背着别人的原始数据，主 Agent 只看到结构化字段，8 个候选也不会飘。
- **可复算**：合并、校验、打分都是纯函数（`lib/research.ts` 之后没有任何模型参与），同输入同输出。
- **失败可见**：子 Agent 超时或回的不是 JSON，会进 `failures`，再进报告 `dataGaps`，不会悄悄消失。
- **限流**：批次之间串行，接真实 API 时把 `concurrency` 调到 1–2 就行，不用改代码。

## 四条硬规则（都在 `lib/score.ts` 里，不是提示词）

1. 权重固定：需求 0.3 / 趋势 0.2 / 竞争 0.25 / 利润 0.25；改权重会回显到工具输出。
2. `riskFlags` 命中 `侵权` 或 `认证缺失` → 总分封顶 0.3，且永远不给"打样"。
3. `evidence` 少于 3 条 → 置信度 0.6（其余为 1）。
4. 最终分 = 加权原始分 × 封顶系数 × 置信度；排序同分按 id，结果可复现。

## 下一步

- 搜索页已经换成亚马逊美国站。月搜索量、成本和专利仍没有公开接口；
  `concurrency` 接更多页面时往下调（`lib/subagent.ts` 的 `normalizeConcurrency` 上限 8）。
- 报告要查询时再上 SQLite，`Report` 结构不用改。
- 站点口径目前仍是 Amazon US（mock 数据与 `AGENTS.md`）；改成 TikTok Shop / Temu 需要动
  `Marketplace`、指标定义（视频转化、达人分销、低价爆款节奏）和 mock 数据。
