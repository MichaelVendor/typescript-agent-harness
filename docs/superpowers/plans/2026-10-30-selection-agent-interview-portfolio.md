# selection-agent 面试作品规划（应用层 Agent）

> 状态：P0 已落地（INTERVIEW.md + `pnpm eval` 5/5）。目标岗：**应用层 Agent 开发**。  
> 策略：不新开项目，在现有 `examples/selection-agent` 上补齐 **Eval + Trace + 面试 README**。

## 一句话目标

做出一份面试官能在 10 分钟内看懂的作品：**业务闭环已有，补上「怎么证明它可靠」和「我怎么设计工具/护栏」**。

## 为什么不另起炉灶

| 已有资产 | 面试可讲点 |
| --- | --- |
| `tools/` + `skills/select-to-shelf` | 工具拆分、skill 约束路径 |
| `set_marketplace` / 选站闸门 | 护栏：没选站不能搜 |
| `plugins/run-log.ts` → `out/run-log.jsonl` | Trace 雏形 |
| `scripts/smoke.ts`、`smoke-orchestration.ts` | 无模型冒烟 |
| 模拟后台 7455 + 结果看板 | 端到端演示 |

缺口主要是：**可断言的评测用例**、**把 trace 讲成能力**、**面向面试官的半页说明**（现 README 偏运行手册）。

## 范围

### 做（P0）

1. **Eval 套件**：固定用例 + 可脚本断言（尽量不起真模型）  
2. **Trace 说明与最小增强**：复用 `run-log`，补「顺序断言」能力  
3. **面试 README**：`INTERVIEW.md`（或 README 置顶一节），5 分钟叙事

### 不做（本轮）

- 不换模型供应商、不自研 Agent 框架  
- 不大改 seller-backend / board-page UI（已够演示）  
- 不改 AGENTS.md / tah 源码（除非 eval 发现铁律与实现冲突，再单独立项）  
- 不追求「全链路真模型 CI」（贵且脆）；真模型只作可选手工 demo

## 能力地图 → 交付物映射

```
业务目标（选品→上架演示）
    ↓
工具边界（search / research / score / prepare / set_marketplace / …）
    ↓
编排护栏（select-to-shelf skill、选站闸门、人确认）
    ↓
Trace（run-log.jsonl + 顺序检查）
    ↓
Eval（黄金路径 + 故意失败）
    ↓
面试叙事（INTERVIEW.md）
```

---

## Workstream 1：Eval 套件

### 目标

用脚本回答：「这条路径有没有按设计走？」而不是「模型文案好不好看」。

### 建议目录

```
examples/selection-agent/
  eval/
    cases/                 # 用例定义（json 或 ts）
      happy-de.json
      happy-us.json
      fail-no-marketplace.json
      fail-search-before-set.json
    assert-trace.ts        # 读工具调用序列，断言顺序/出现/禁止
    run-eval.ts            # 入口：跑 case → 调现有 lib/假编排 → 打印 PASS/FAIL
  package.json             # 可选加 "eval": "…"
```

### 用例设计（先 5 条）

| ID | 类型 | 场景 | 断言（示例） |
| --- | --- | --- | --- |
| `happy-de` | 黄金路径 | 德国站 + 已知 query（如 dekotablett） | 工具序含 `set_marketplace`→`search_products`→…→`score_and_save`；报告文件存在；动作集合 ⊆ {上架,观察,放弃} |
| `happy-us` | 黄金路径 | 美国站 + bathroom tray | 同上；货币/站点字段为 US；`publish` 相关文案或 case 状态为美国站 |
| `gate-no-market` | 故意失败 | 未 `set_marketplace` 直接 `search_products` | 必须失败或抛闸门错误；**不得**静默用 DE |
| `gate-order` | 故意失败 | 序列里 `search_products` 出现在 `set_marketplace` 之前 | `assert-trace` 判 FAIL |
| `score-no-invent` | 约束 | 缺利润数据的候选 | 报告里利润维为缺数据/`—`/gap，禁止出现臆造采购价 |

> 实现策略：P0 用**程序化调用**（直接调 `lib/` + 假子 Agent，对齐 `smoke-orchestration.ts`），不依赖 LLM。  
> 「模型是否遵守 skill」另开 **P1 手工清单**（见下），不阻塞脚本评测。

### 与现有 smoke 的关系

- `smoke.ts` / `smoke-orchestration.ts`：**保留**，当作底层健康检查  
- `eval/`：**新增**，强调「用例表 + 断言」；可内部复用 smoke 的 fakeChild / mock 源  
- 不删旧脚本，避免打乱现有习惯

### 成功标准

```bash
cd examples/selection-agent && node --experimental-strip-types eval/run-eval.ts
# 5/5 PASS，失败时打印：case id、期望序、实际序
```

### 面试话术挂钩

> 「应用层 Agent 的质量不靠体感，我靠固定用例锁工具顺序和闸门；模型换成别家，这套 eval 还能跑。」

---

## Workstream 2：Trace（复盘）

### 现状

- `plugins/run-log.ts` 在 `tool.finished` 时追加 `out/run-log.jsonl`（工具名、asin、时间等）

### P0 增强（小改，可选项按优先级）

1. **文档化**：在 INTERVIEW.md 写清「一次 run 如何打开 run-log 复盘」  
2. **结构化字段**（若现日志不够）：每行至少 `name`, `ok`, `at`；尽量有 `args` 摘要（注意脱敏，别写密钥）  
3. **`assert-trace.ts`**：输入「期望工具名序列（可含通配）」+「实际 jsonl 片段」→ 布尔结果  
4. **会话边界**：每次 eval run 写到 `out/eval/<case-id>/<timestamp>.jsonl`，避免和交互会话混在一起

### 不要求（P0）

- 完整 OpenTelemetry  
- UI 里画火焰图  

### 成功标准

- 任意失败的 eval case 能指出「卡在第几个工具、实际调用了啥」  
- 面试时能打开一份 jsonl，指着说完整路径  

### 面试话术挂钩

> 「出问题先看 trace：是模型乱调工具，还是数据源缺字段——两者修法完全不同。」

---

## Workstream 3：面试 README（`INTERVIEW.md`）

### 目标

面试官 / 自己复习用的 **1 屏半** 说明，不是运维手册。

### 建议目录结构

```markdown
# selection-agent — 应用层选品 Agent（面试说明）

## 1. 解决什么问题（3 句）
## 2. 架构一图（ASCII）
## 3. 工具边界（表：工具 | 副作用 | 谁调用）
## 4. 护栏与人机分工（选站闸门、ask_user、score 不由模型心算）
## 5. 怎么证明它工作（eval 怎么跑、trace 在哪）
## 6. 我做过的权衡（3 条即可）
## 7. 现场 demo 步骤（7441 + 7455，2 分钟路径）
```

### 「权衡」建议写死的 3 条（可改表述，勿空）

1. **Skill 约束 vs 纯自治**：上架路径用 `select-to-shelf`，避免模型跳过报价/确认。  
2. **规则引擎算分**：`score_and_save` 落盘，模型不心算总分（防幻觉数字）。  
3. **演示数据 vs 真抓取**：默认 dossier/DE·US 演示池；真亚马逊抓取单独开关，评测不依赖外网。

### 与 README.md 分工

| 文件 | 读者 |
| --- | --- |
| `README.md` | 怎么安装、怎么 smoke |
| `INTERVIEW.md` | 为什么这样设计、怎么评测、怎么讲 |

---

## 实施顺序（建议 3 个小迭代）

### Iteration 1 — 叙事与用例纸面（0.5～1 天）

- [x] 写 `INTERVIEW.md` 初稿（可先无跑通的 eval）  
- [x] 定稿 5 条 case 的 JSON/表（期望工具序写成字面量）  
- [x] 列出现有 `run-log` 字段是否够 `assert-trace` 用  

**验收**：你能不看代码讲完「架构 + 3 个权衡 + demo 步骤」。

### Iteration 2 — Eval 可跑（1～2 天）

- [x] `eval/assert-trace.ts` + `eval/run-eval.ts`  
- [x] 至少 `happy-de` + `gate-no-market` 绿灯  
- [x] `package.json` 增加 `eval` 脚本  
- [x] INTERVIEW.md 补上「如何跑 eval」  

**验收**：`pnpm eval`（或 node 命令）本地 可重复 PASS。

### Iteration 3 — 补全与打磨（1 天）

- [x] 补上 `happy-us`、`gate-order`、`score-no-invent`  
- [x] eval 输出独立 trace 目录  
- [ ] （可选）P1：一张「真人+模型」手工检查表（勾选：是否弹出选站、是否出结果图）  
- [ ] 自检：对着 INTERVIEW.md 录音讲 5 分钟，改含糊处  

**验收**：模拟面试：屏幕共享 README/INTERVIEW + 跑一条 eval + 打开一条 trace。

---

## P1（有余力再做）

| 项 | 说明 |
| --- | --- |
| 真模型抽检脚本 | 录制 1 次会话的 run-log，事后用 `assert-trace` 离线判（不进 CI） |
| 失败注入 | mock 源故意缺 keyword → 报告 gaps 非空 |
| 对比实验 | 关掉选站闸门跑一次，展示 eval 如何抓住回归 |

---

## 风险与注意

1. **别把「聊天质量」当 eval 主指标**——应用层作品应锁工具序与闸门。  
2. **真模型 flaky**——P0 脚本路径必须无 key 可跑（对齐现有 smoke）。  
3. **范围膨胀**：又想改看板又想改后台 → 面试故事变散；UI 维持现状。  
4. **仓库里大量未提交 WIP**：开工前先确认哪些文件进作品分支，避免和无关改动缠在一起。

---

## 面试检查清单（完成定义）

- [ ] 能画架构图并指出「模型 / 规则 / 人」各自边界  
- [ ] 能现场跑通一条无模型 eval，并解释 FAIL 时看哪  
- [ ] 能打开一份 run-log/jsonl 讲完整工具链  
- [ ] `INTERVIEW.md` 存在且与实现一致  
- [ ] Demo：7441 选站 → 出榜/图；可选 7455 看上架壳子（2～3 分钟）

---

## 下一步（等你点头再写代码）

1. Iteration 1：落 `INTERVIEW.md` + 5 条 case 文件（仍可不写 runner）  
2. 或直接 Iteration 2：连 runner 一起做  

你更想先「只写文档和用例表」，还是「文档 + 可跑 eval 一起上」？
