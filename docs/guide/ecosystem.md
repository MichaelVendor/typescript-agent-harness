# 生态：Permissions / MCP / Scheduler / Subagent

状态：✅ Phase 4 + 6 + 官方 MCP 客户端

## Permissions

只读不是靠 prompt，而是策略：

```ts
runtime.use(permissionsPlugin({ deny: ["write_file", "execute_command"] }));
```

- `deny` 的工具：对模型不可见，`execute` 直接失败并发 `permission.denied`
- `allow` 若设置：只有名单内的工具可见/可跑

执行检查是挂在 `tool.execute` waterfall 上的拦截器（v0.22 起）；`packages/tools` 只在 `listSchemas` 里 `tryGet(PERMISSIONS)` 隐藏工具。没有权限插件时行为与 0.3 相同。

CLI：`tah --allow <tool>` / `tah --deny <tool>`（可重复；默认不挂策略）。

### 人工审批（v0.22）

```ts
runtime.use(
  approvalPlugin({
    tools: ["write_file", "execute_command"],
    ask: async (call) => "yes", // "yes" | "no" | "always"
  }),
);
```

- 只拦 `tools` 里列出的工具；`always` 后本次运行内该工具不再问
- `no`：不执行，返回 `ok:false` + `rejected by user`，并发 `permission.denied` / `tool.failed`
- 放在 `permissionsPlugin` 之后挂载：被策略拒绝的工具不会再弹审批

CLI 默认对 `write_file` / `execute_command` 开审批，`--yes` 跳过。

## MCP

MCP 后端被适配成同一个 `Tool`，再 `tools.register`。Loop 看不到 MCP 特殊路径。

```ts
runtime.use(mcpPlugin({ backend: inProcessPingBackend() }));
// or: stdioMcpBackend({ command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] })
// or: httpMcpBackend({ url: "https://example.com/mcp", headers: { Authorization: "Bearer …" } })
```

CLI：`tah --mcp <cmd> --mcp-arg …`（默认关）。`tah.config.json` 里也可写远程 `url` / `headers`（见 [配置参考](/design/config)）。

stdio 与远程 HTTP 都走官方 `@modelcontextprotocol/client`。每个服务自己的工具照旧登记；至少有一个服务列出资源或提示词时，才额外挂上 `list_resources` / `read_resource` 或 `get_prompt`（全局各一个，聚合全部已连接服务）。

`tah chat` 与 `tah serve` 里，提示词名字符合 skill 规则（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）时可用 `/名字` 展开：用户看到的那一行保持原样，补充文本包在 `<mcp_prompt name="...">` 里。与本地 skill 同名时用 skill。必填参数、多服务同名时不展开，仍可用 `get_prompt`（同名时要带 `server`）。

`McpBackend` 是接缝：进程内 `ping`、stdio、远程 HTTP 都实现同一接口（含 `listResources` / `readResource` / `listPrompts` / `getPrompt`）。

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
