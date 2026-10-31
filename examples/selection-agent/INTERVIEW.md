# selection-agent — 应用层选品 Agent（面试说明）

选品分析 Agent：给出**排行榜 + 证据 + 建议动作**，不做自动大货决策。  
运行手册见 [README.md](./README.md)。本文只讲**设计与如何证明它可靠**。

## 1. 解决什么问题

跨境卖家给一个方向（类目/关键词）后，需要在德/美站点池里比较候选：需求、趋势、竞争、利润、合规。  
人很难同时查四类数据并统一口径。本 Agent 用工具取数、规则打分、Skill 约束上架流程，人只在关键闸门签字。

## 2. 架构一图

```
用户意图
   │
   ▼
Skill select-to-shelf（路径约束）
   │
   ├─ set_marketplace     ← 闸门：未选站不能搜
   ├─ search_products     ← 工具：事实来自 DE/US 档案
   ├─ research_candidates ← 每候选子 Agent × 四件套取证
   ├─ score_and_save      ← 规则引擎算分落盘（模型不心算）
   ├─ prepare_case / ask  ← 人确认后再碰模拟后台
   └─ 结果看板 PNG        ← 可截图交付物
         │
         ▼
   plugins/run-log → out/run-log.jsonl（复盘）
   eval/           → 无模型固定用例（回归）
```

**分工**：工具负责事实 · 模型负责判断与编排 · 规则负责打分约束 · 人负责签字。

## 3. 工具边界（摘）

| 工具 | 副作用 | 谁调用 |
| --- | --- | --- |
| `set_marketplace` | 写本轮站点会话 | 主 Agent（开场） |
| `search_products` | 只读选品池 | 主 Agent；**依赖已选站** |
| `keyword_metrics` 等四件套 | 只读 | 子 Agent |
| `score_and_save` | 写 `out/reports/*.json` + 看板 | 主 Agent |
| `prepare_case` / `select_listing` | 写 case / 模拟后台 | 主 Agent（人确认后） |

## 4. 护栏与人机分工

- **选站闸门**：`search_products` 调 `requireMarketplace()`，未选站返回 error，不静默默认德国站。  
- **Skill**：`skills/select-to-shelf` 规定先选站、询价/试样空着不编、提交后才开后台。  
- **打分**：权重与封顶在 `lib/score.ts`；缺证据进 `gaps`，侵权等风险封顶。  
- **人**：`ask_user` 选站/确认上架；Agent 不替用户点「发布」。

## 5. 怎么证明它工作

### 无模型 Eval（推荐面试现场跑）

```bash
cd examples/selection-agent
pnpm eval
# 或：node --experimental-strip-types eval/run-eval.ts
```

覆盖：

| Case | 证明什么 |
| --- | --- |
| `happy-de` / `happy-us` | 工具序：`set_marketplace` → `search` → `research` → `score`；货币对 |
| `gate-no-market` | 未选站搜失败 |
| `gate-order` | 错误序会被 assert-trace 抓住 |
| `score-no-invent` | 缺利润 → gaps 含「利润（无采购成本）」 |

Trace 落在 `out/eval/<case-id>/trace.jsonl`。

单元测断言本身：

```bash
node --test --experimental-strip-types eval/assert-trace.test.ts
```

### 交互 Trace

真会话里 `plugins/run-log.ts` 追加 `out/run-log.jsonl`（工具名 / ok / asin）。

### 冒烟（更底层）

```bash
pnpm smoke
pnpm smoke:orchestration
```

## 6. 三个权衡

1. **Skill 约束 vs 纯自治**：上架路径用 skill，避免跳过报价/确认直接改后台。  
2. **规则引擎算分**：分数与动作由 `score_and_save` 落盘，模型不加减出总分。  
3. **演示档案 vs 真抓取**：默认 DE/US dossier，评测不依赖外网；真抓取单独开关。

## 7. 现场 Demo（约 2～3 分钟）

1. 启动：`tah serve` 于 selection-agent（如 7441）+ `seller-backend`（7455）。  
2. 开场选站 → 给关键词 → 看排行榜/结果图。  
3. （可选）确认后打开 http://127.0.0.1:7455/ 看模拟上架壳。  
4. 另开终端跑 `pnpm eval`，指着 FAIL 时看 `out/eval/.../trace.jsonl`。

## 面试一句话

> 我做的是应用层选品 Agent：Skill 约束上架路径，工具取数，规则打分；用固定 eval 锁工具顺序和选站闸门，用 run-log/jsonl 复盘，而不是只看模型文案。
