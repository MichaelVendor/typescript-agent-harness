# brief-agent — 竞品简报 + 选品上架（已合并）

同一约定式项目：`competitive-brief` 出简报，`select-to-shelf` 做选品打分与模拟上架。选品实现在 `lib/selection/`；原 `examples/selection-agent` 已归档指向此处。

简报默认档案 `data/mock-de.json`（DE 小家电/家居）。**不做自动决策、不下单给真客户。**

无模型回归：`pnpm eval`（简报）+ `pnpm eval:selection`（选品）。

**变更 diff：** `compose_brief` 会在 `out/briefs/*.json` 里找同组 `rows[].id` 的最近一份，在 markdown 增加「### 变更」（价/卖点/差评主题/增减行）。

**模板：** `compose_brief` 参数 `template`：`ops`（默认细表）或 `exec`（老板一页纸：结论 + 对照≤3 + 要事）。

**任务记录：** `save_brief` 成功后追加一行 `out/tasks.jsonl`（ts / template / rowIds / 路径 / source），作按次计费底。

**差评清洗：** 评论摘录按 DE/EN 词表拆正负；「差评主题」只出负面，正面进「好评要点」。

**每周订阅：** `subscribe_targets` 写入 `out/subscriptions.json`；`pnpm weekly` 跑所有 enabled 订阅。cron 例：`0 9 * * 1 cd …/brief-agent && BRIEF_SOURCE=live pnpm weekly`。

**推送：** `BRIEF_NOTIFY=telegram,feishu`（可只开一个）。TG 需 `TELEGRAM_BOT_TOKEN` + `BRIEF_TG_CHAT_ID`；飞书需 `BRIEF_FEISHU_WEBHOOK`（自定义机器人）。推送失败只打日志，不打断落盘。

**数据源：** 环境变量 `BRIEF_SOURCE`：

| 值 | 行为 |
| --- | --- |
| 缺省 / `mock` | 读 `data/mock-de.json`（默认，eval 主路径） |
| `live` | curl 搜索后补 `/dp` 卖点 + `/product-reviews` 评论；仍空且未设 `BRIEF_BROWSER=0` 时 Chrome 升档（评论页 → 滚 `/dp`）。Eval 用 fixture，不打外网 |

```bash
BRIEF_SOURCE=live pnpm start   # 真抓演示（可能被挡）
```

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
pnpm weekly   # 按 out/subscriptions.json 出简报
pnpm eval     # 无模型黄金路径
pnpm test
pnpm typecheck
```

冒烟会打印 `ok …/out/briefs/<时间戳>.md`，并把 JSON/Markdown 写到 `out/briefs/`。

## 结构

```
AGENTS.md                 角色、铁律、流程、回复四块
skills/competitive-brief/ 路径约束：resolve → fetch → extract → compose → save
lib/sources/              mock | live（DE 搜索 HTML）
data/fixtures/            live eval 用 HTML
tools/
  resolve-targets.ts      → resolve_targets
  fetch-product-pages.ts  → fetch_product_pages（可传 targets）
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
