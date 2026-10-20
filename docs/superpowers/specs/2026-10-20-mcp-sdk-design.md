# 官方 MCP SDK 设计

状态：📐 待实现

## 背景

`packages/mcp` 自己用换行 JSON-RPC 连 stdio 子进程，只做 `tools/list` 和 `tools/call`。协议版本写死在 `2024-11-05`。资源、提示词和远程 HTTP 都没有。

本设计换成官方 `@modelcontextprotocol/client`（v2，协议 2026-07-28）。Agent 循环仍然只认识工具。资源、提示词和远程地址从这条连接上长出来。

## 目标

- stdio 与远程 HTTP 都走官方 `Client`。
- 对方的工具照旧登记进 `Tool` 注册表。
- 有资源时登记 `list_resources` / `read_resource`；有提示词时登记 `get_prompt`。
- `tah chat` 与 `tah serve` 里，符合 skill 名字规则的提示词可以用 `/名字` 展开。
- 现有 `extensions.mcp` 的 `command` + `args`，以及 `--mcp` / `--mcp-arg`，继续可用。
- 内置浏览器的 Playwright MCP 改为走同一个官方客户端，对外工具名不变。

## 非目标

- OAuth，以及「工具执行到一半向用户弹表单」（elicitation）。
- 控制面聊天页的新界面。页面不改。
- 资源侧栏、提示词菜单。
- 断线自动重连，以及对方 `listChanged` 之后热更新工具列表。
- 把 `tah.config.json` 纳入文件监视。改配置仍要重启进程。
- sampling。

## 连接

`packages/mcp` 依赖 `@modelcontextprotocol/client`。每个服务仍是一个 `McpBackend`：

- `listTools` / `callTool`
- `listResources` / `readResource`
- `listPrompts` / `getPrompt`
- `close`

实现内部使用官方 `Client.connect(transport)`，不再手写 JSON-RPC。

| 配置 | 传输 |
| --- | --- |
| `command` + `args` | `StdioClientTransport`（`@modelcontextprotocol/client/stdio`） |
| `url` + 可选 `headers` | 先 `StreamableHTTPClientTransport`；失败则新建一个 `Client`，用同一组 `headers` 再试一次 `SSEClientTransport` |

`inProcessPingBackend` 补上四个新方法：资源与提示词都返回空列表，读和取提示词抛「没有」。它不走官方客户端。

`mcpPlugin` 只登记对方自己的工具。`contextToolsFromMcp(servers)` 单独返回那 0–3 个固定工具，由 `bootRuntime` 在全部服务连上之后登记一次。浏览器启动 Playwright 时只调用 `listTools` / `callTool`，不登记这三个工具。

## 资源与提示词

服务标签：stdio 是 `command` 与 `args` 用单个空格拼起来；远程是配置里的 `url` 原文。两个服务算出同一个标签时，启动失败。

三个工具的名字固定，只在确实有内容时登记：

| 工具 | 何时登记 | 行为 |
| --- | --- | --- |
| `list_resources` | 至少一个服务列出了资源 | 返回全部资源。每条含 `server`（标签）、`uri`、`name`、`mimeType`（没有则为空字符串） |
| `read_resource` | 同上 | 参数 `uri`。文本原样返回。二进制只返回 `已省略（<mime>）`，没有 mime 时用 `application/octet-stream`。一条资源里既有文本又有二进制时，文本照常返回，二进制各占一行省略说明。未知 URI 让该工具失败 |
| `get_prompt` | 至少一个服务列出了提示词 | 参数 `name`，可选 `arguments`（对象），同名时必填 `server`（标签）。工具描述里列出每个提示词的名字、所属标签、参数名。未知名字或同名却没给 `server` 时，该工具失败 |

某个服务的能力列表为空，就不为它登记对应工具。这三个名字若与任一对方工具重名，启动失败，沿用现在的重名错误。

`read_resource` 与 `get_prompt` 在已连接的服务里按上次 `list*` 的结果找到归属，再向那个服务读取。

## 斜杠命令

展开做在 `ChatHost` 里。因此 `tah chat`、`tah serve`，以及走同一个 Host 的 `tah agent-host`（含控制面）都会生效。控制面不加按钮或菜单。`tah run` 不展开斜杠；模型仍可调用 `get_prompt`。

提示词名字必须匹配现有 skill 规则：`^[a-z0-9]+(?:-[a-z0-9]+)*$`。不符合的只能用 `get_prompt`。

`/名字` 把提示词消息拼进发给模型的补充文本，用户看到的那一行保持原样。补充文本包在 `<mcp_prompt name="...">` 里，只含各条消息的文本，按返回顺序用空行连接。

不展开的情况：

- 与本地 skill 同名：用 skill。
- 任一参数标记了 `required: true`。
- 多个服务有同一个名字。

这三种仍可用 `get_prompt`。同名时要带 `server`。

## 配置与失败

`extensions.mcp` 仍是一个对象或一个数组。每一项只能是下面两种之一：

```json
{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"] }
```

```json
{ "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
```

`command` 与 `url` 只能出现一个，也不能两个都没有。`args` 只属于 `command`，缺省为 `[]`，元素必须是字符串。`headers` 只属于 `url`，每个值必须是字符串，缺省为无请求头。其它键报 `unknown mcp option`。

`--mcp` / `--mcp-arg` 仍盖掉整份列表，变成一个 stdio 服务。没有 URL 专用的命令行参数。

启动时某个服务连不上，进程起不来。错误写明该条的命令行或 URL。远程地址两次都失败时，错误里包含 Streamable HTTP 与 SSE 各自的原因。`headers` 不写入错误文本。

连上之后，单次 `callTool` / `readResource` / `getPrompt` 失败只让该工具失败，当前轮继续。不自动重连。不订阅列表变更。

## 测试

- 配置：合法的 `url` 与 `headers`；`command` 与 `url` 同时出现、两个都没有、`headers` 的值不是字符串，都报现有风格的配置错误。`--mcp` 盖掉数组的行为不变。
- 固定工具用假的 `McpBackend`：有资源才登记前两个工具；有提示词才登记 `get_prompt`，描述里含名字；没有的能力不登记；与对方工具重名则失败；二进制资源得到省略说明。
- HTTP 回退用两个注入的传输工厂，各被调用一次，不监听真实端口，也不访问外网。
- 斜杠：合法名字会展开；与 skill 同名时用 skill；必填参数不展开；重名不展开。
- 现有 stdio 夹具测试保留：官方传输若不再使用换行 JSON，只改夹具的成帧，断言仍是列出并调用 `ping`。
- 浏览器对外工具名不变，现有浏览器测试继续通过。控制面页面无新测试。

## 文档

实现时改这些说明，去掉「未做官方 MCP SDK」：

- `docs/design/config.md`：`url` / `headers` 与失败行为
- `docs/guide/ecosystem.md`、`docs/guide/tools.md`：官方客户端、三个固定工具、斜杠
- `docs/guide/status.md`：MCP 一行改为已接官方客户端；未做列表里去掉官方 MCP SDK
