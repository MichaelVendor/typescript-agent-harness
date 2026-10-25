#!/usr/bin/env bash
# 启动选品 Agent 的交互式终端 UI（真模型）。
# 用法：scripts/chat.sh            — 恢复最近一次会话
#      scripts/chat.sh --mock     — 不调模型的假 LLM（只验证工具接线）
#      scripts/chat.sh --session <id|n>  — 指定会话
#
# 为什么不用 `pnpm start`：`tah` 的 bin shim 依赖 PATH 里有 node，
# 二进制版 node 机器上 PATH 可能没有；这里直接用 dot-node 跑 CLI 入口。
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="${NODE_BIN:-$(command -v node || echo /usr/local/bin/node)}"
cli="$here/node_modules/@typescript-agent-harness/cli/dist/cli.js"

if [[ ! -f "$cli" ]]; then
  echo "找不到 $cli" >&2
  echo "先在仓库根目录构建：pnpm build --filter @typescript-agent-harness/cli..." >&2
  exit 1
fi

cd "$here"
exec "$node_bin" "$cli" chat --yes "$@"
