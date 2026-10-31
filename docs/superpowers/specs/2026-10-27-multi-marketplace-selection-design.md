# 多平台选品 Agent（DE + US 演示）

状态：已实现。计划见 Cursor plan「Multi-platform agent DE+US」。

## 决策

- 第二平台：亚马逊美国站，演示级本地档案
- 开场 `ask_user` 选「德国站 / 美国站」→ `set_marketplace`，整轮绑定
- 不改 tah；流程写在 skill / 工具 next
- 模拟后台仍 `7455`，按站点切换文案与货币

## 关键入口

- `tools/set-marketplace.ts`
- `lib/marketplace.ts`、`lib/sources/dossier-us.ts`、`lib/sources/index.ts`
- `data/us-search.json`、`data/us-keyword-metrics.json`
- `skills/select-to-shelf/SKILL.md` 步骤 0
- `seller-backend/index.html`、`serve.py`
