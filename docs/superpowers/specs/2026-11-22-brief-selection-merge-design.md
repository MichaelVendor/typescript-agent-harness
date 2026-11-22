# 合并 selection-agent → brief-agent（全量）

状态：已合并；`pnpm test` / `pnpm eval` / `pnpm eval:selection` / `pnpm typecheck` 绿。  
底座：`examples/brief-agent`。选品代码进 `lib/selection/` + 原工具名迁入 `tools/`。

## 原则

- 简报 `lib/*` 不动；选品放 `lib/selection/**`
- `selection-agent/` 保留并 README 归档指向 brief-agent
- 一个 `AGENTS.md`：简报 / 选品两阶段

## 验收

`pnpm test`、`pnpm eval`、`pnpm eval:selection`、`pnpm typecheck` 绿。
