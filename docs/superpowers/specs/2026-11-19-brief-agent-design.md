# 竞品/市场简报 Agent（brief-agent）设计

状态：P0 已实现（见 examples/brief-agent；计划 docs/superpowers/plans/2026-11-19-brief-agent.md）。  
定位：tah 上第一款**可对外收费的垂直 Agent 产品**（应用层）；不改 DefaultLoop / Super-agent Runtime。  
对照：同构于 `examples/selection-agent`（Skill + 子 Agent 取证 + 规则落盘 + 无模型 Eval），交付物是简报而非选品排行榜。

## 1. 背景与目标

tah 的工程能力（约定式项目、Skills、子 Agent、权限、Eval）是护城河；收费形态选「垂直 Agent 产品」。在未锁定行业时，用愿付费 / 冷启动 / tah 贴合 / 独自交付四条筛出本方向优于选品产品化与标书组装。

**一句话：** 面向运营/产品经理的竞品简报 Agent——输入目标（竞品 URL、品牌、或类目关键词），输出一份可验收的 Markdown/JSON 简报；每条结论必须带证据链接或摘录。不做自动决策、不下单、不代发消息给客户。

**第一版垂直：** Amazon 德国站小家电/家居；盯 3–8 个竞品 + 变更摘要（P0 以 mock 档案为主）。

**成功标准：**

1. 用户约 10 分钟内拿到第一份完整简报（价格带、卖点、差评主题、近况变化、缺口清单）。
2. 无模型 Eval：固定用例下证据条数、禁止臆造字段、输出 schema 全部通过。
3. 作者自己愿意每周用它盯一批竞品。

**P0 明确不做：** 多站点、自动跟价、自动改 listing、IM/Super-agent 异步工单。

## 2. 架构

独立约定式项目 `examples/brief-agent/`，运行入口 `tah chat` / `tah serve`。

```
用户意图（URL / 品牌 / 类目）
        │
        ▼
Skill: competitive-brief     ← 路径约束：先收集 → 再合成 → 再落盘
        │
        ├─ resolve_targets      规范化目标列表（最多 8 个）
        ├─ fetch_product_pages  拉页面/档案（工具出事实）
        ├─ extract_signals      子 Agent 分头：价格/卖点/差评/变更
        ├─ compose_brief        规则拼 schema，模型只写判断句
        └─ save_brief           落盘 out/briefs/<ts>.{md,json}
                │
                ▼
        plugins/run-log → out/run-log.jsonl
        eval/           → 无模型黄金路径 + 禁止臆造
```

**分工铁律（写入 `AGENTS.md`）：**

- 工具负责事实；模型负责归纳与排序；规则负责 schema / 缺数据标记；人负责「这份能不能给老板看」。
- 缺字段一律 `null` 或「缺数据」，禁止补全价格、评论数、排名。
- 最终回复只贴 `compose_brief` / `save_brief` 产出的结构，不另起散文报告。

**与 selection-agent：** 同构骨架，独立目录与 `AGENTS.md`；不揉成一个巨 Agent。共享模式（Eval、run-log、子 Agent 交 JSON）可抄，代码不强制抽公共包（P0 YAGNI）。

## 3. 数据流

1. 用户给出目标 → `resolve_targets` 产出 `{ targets: [{ id, url?, asin?, title? }], market: "DE" }`；超过 8 个截断并声明。
2. `fetch_product_pages`：优先本地档案 / mock；可选真抓。单条失败记入 `failures`，不中断整批。
3. `extract_signals`：每个 target 一个子 Agent；四桶信号固定为 `pricing` / `positioning` / `reviews` / `changes`。子 Agent 只调只读工具，经 `submit_signals` 交 JSON。
4. `compose_brief`：合并信号 → 固定 schema（结论一句、对照表、差评主题 TopN、缺口清单）；缺证据的判断句降级或不写。
5. `save_brief`：写 `out/briefs/<ts>.json` 与同内容 `.md`；主回复只引用落盘结果。

## 4. 错误处理与权限

- 单 target 失败：进入 `failures[]`，其余继续；简报单独一节「未取到」。
- 子 Agent 非 JSON 或超时：最多重试 1 次，然后记失败；主 Agent 不手补数字。
- 全员失败：仍落盘空壳简报 + 明确「本次无可用证据」，不装作成功。
- 权限：P0 默认 deny 写仓库外路径。浏览器若启用，目标域名白名单策略在实现计划中写清（实现可后置到 P1）。

## 5. 评测

| 用例 | 断言 |
| --- | --- |
| `happy-mock-3` | 3 个 mock 竞品 → schema 合法；每竞品 ≥3 条 evidence；md/json 均存在 |
| `gap-missing-price` | 缺价格时字段为 null/缺数据，正文不得出现臆造欧元价 |
| `cap-over-8` | 输入 12 个 → 只处理 8 个并声明截断 |
| `partial-fetch-fail` | 1 个 fetch 失败 → `failures` 有记录且其余仍出表 |
| `no-invent-rank` | 工具未给排名时禁止出现具体名次数字 |

入口：`examples/brief-agent` 下 `pnpm eval`（无模型、可进 CI）。策略对齐 selection-agent：程序化调用 lib + 假子 Agent，不依赖 LLM。

## 6. 分期与长期规划挂点

**P0（可收款 MVP）**

- 注：P0 的 `extract_signals` 为程序化取证；子 Agent 抽取延后到 P1。
- `AGENTS.md` + Skill `competitive-brief`
- 工具：`resolve_targets` / `fetch_product_pages` / `extract_signals` / `compose_brief` / `save_brief`，以及子 Agent 只读信号工具 + `submit_signals`
- mock DE 小家电/家居档案（3–8 个竞品）
- `eval/` 五条用例全绿
- 交付物：`out/briefs/*.md` + `*.json`

**P1**

- 真抓 / 浏览器补页；相对上次 brief 的变更 diff
- 简报模板可选（老板一页纸 / 运营细表）
- 按次计费所需的最小本地任务记录

**P2（长期，不挡 P0）**

- 多站点；订阅式每周自动 brief
- Super-agent + 飞书/TG：异步工单「盯这 5 个竞品」
- 与 selection-agent 同构产品线：简报 → 选品 → 上架（两个项目、两个 Skill）

**路线图表述：** 垂直产品 #1：竞品简报 Agent（tah 约定式 + Eval）；验证付费后再开选品产品化与 IM 异步。

**验收：** 作者用 mock 跑通；再对 1 个真实类目出 1 份愿意外发的简报；`pnpm eval` 5/5。

## 7. 非目标（全文汇总）

- 不修改 `@typescript-agent-harness/*` 核心包 API 作为本产品前提
- 不在 P0 引入 Super-agent、channel-host、计费后端、多租户
- 不把 brief-agent 与 selection-agent 合并为单一约定式项目
