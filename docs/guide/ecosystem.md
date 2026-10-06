# 生态：Permissions / MCP / Scheduler / Subagent

状态：✅ Phase 4 + 6 stdio

## Permissions

只读不是靠 prompt，而是策略：

```ts
runtime.use(permissionsPlugin({ deny: ["write_file", "execute_command"] }));
```

- `deny` 的工具：对模型不可见，`execute` 直接失败并发 `permission.denied`
- `allow` 若设置：只有名单内的工具可见/可跑

`packages/tools` 在 `execute` / `listSchemas` 里 `tryGet(PERMISSIONS)`，没有权限插件时行为与 0.3 相同。

CLI：`tah --allow <tool>` / `tah --deny <tool>`（可重复；默认不挂策略）。

## MCP

MCP 后端被适配成同一个 `Tool`，再 `tools.register`。Loop 看不到 MCP 特殊路径。

```ts
runtime.use(mcpPlugin({ backend: inProcessPingBackend() }));
// or: stdioMcpBackend({ command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] })
```

CLI：`tah --mcp <cmd> --mcp-arg …`（默认关）。

`McpBackend` 是接缝：进程内 `ping` 与 stdio 子进程（JSON-RPC + `Content-Length`）都实现同一接口。没有把官方 SDK 绑进内核。

## Subagent

`run_subagent` 就是一个 Tool：内部 `SESSION.create()` + `run(task)`。

没有 `SubAgentManager`。

## Scheduler

```ts
runtime.get(SCHEDULER).once("tick", 20, async () => {
  const session = await runtime.get(SESSION).create();
  await session.run("...");
});
```

`every` 做周期任务；`dispose` 时清掉全部 timer。

CLI：`tah --once <ms> run <prompt>`（默认关；没有 `--every`）。

## 演示

```sh
pnpm demo:multi
```
