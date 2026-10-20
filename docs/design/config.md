# 配置参考：`tah.config.json`

状态：✅ 已实现（v0.28）

命令行与约定目录用法见 [CLI](/guide/cli)；本文是 **配置参考**（有哪些键、默认与优先级），对应 Vite 文档里的 Config 区。更细的背景与演进仍写在下文。

## 背景

约定式项目用 `AGENTS.md` / `tools/` / `plugins/` 描述「Agent 是什么」，官方能力却仍靠一长串 CLI 标志（`--exec`、`--builtin-tools`、`--vision`、`--mcp`…）。能力变多后，每次启动记 flag 别扭，也不适合提交到仓库里共享默认挂载。

对齐 Angular 的做法：**约定管代码与角色，config 管工程级开关**。二者并存，不互相取代。

## 目标

- 项目根目录可选 `tah.config.json`（纯 JSON），声明官方 **capabilities**（内置能力包）与 **extensions**（外挂）。
- 与约定目录分工明确；自定义工具仍只放 `tools/`。
- 合并顺序：内置默认 → config → CLI / 环境变量（后者覆盖前者）。
- 无 config 文件时行为与 v0.27 完全一致。

## 非目标

- 用户级 `~/.tah/config`、多层 profile / bundle 叠加
- YAML / TypeScript config（不执行用户配置代码）
- 把 `tools/` / `plugins/` 清单搬进 JSON
- `maxSteps`、`persist`、模型与 API key（仍 flag / `.env`）
- 插件市场

## 加载条件与路径

| 规则 | 说明 |
| --- | --- |
| 路径 | `<cwd>/tah.config.json`（与 `package.json` 同级） |
| 何时读取 | 仅当 `package.json` 依赖 `@typescript-agent-harness/cli`（项目模式）且文件存在 |
| 非项目 | 忽略同名文件（与 `tools/` 同安全边界） |
| `.tah/` | 仍只放运行时状态（`cli.db`、attachments），不放此 config |

## Schema（v1）

```json
{
  "capabilities": {
    "coding": true,
    "web": false,
    "vision": false
  },
  "extensions": {
    "mcp": [
      { "command": "npx", "args": ["-y", "some-mcp-server"] },
      { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
    ]
  },
  "permissions": {
    "deny": ["execute_command"]
  }
}
```

| 键 | 含义 |
| --- | --- |
| `capabilities.coding` | `true` / `false`，或 `{ "exec": boolean }`（默认 `exec: true`）。挂 `list_files` / `read_file` / `grep` / `write_file` / `edit_file`，以及可选的 `execute_command` |
| `capabilities.web` | 官方 `web_fetch`（读网页）与 `web_search`（搜索；没 key 用 Exa + Bing，有 Tavily key 用 Tavily，v0.37.4）。省略时跟随 `coding`；写 `false` 关掉（v0.31） |
| `capabilities.browser` | 内置浏览器（Playwright MCP）：先只挂 `browser_open`，调用并经用户批准后才启动 Chrome、挂上 18 个浏览器工具。省略时跟随 `web`；写 `false` 关掉；`--mock` 时不挂（v0.31，见 [内置浏览器](/design/browser)） |
| `capabilities.vision` | `tah serve` 图片多模态投影（同 `--vision` / `TAH_VISION=1`） |
| `extensions.mcp` | 一个服务项，或这样的数组。每项只能是 stdio `{ "command": string, "args"?: string[] }`（`args` 缺省 `[]`，元素须为字符串），或远程 `{ "url": string, "headers"?: Record<string, string> }`（`headers` 为 HTTP 请求头，值须为字符串；缺省为无额外请求头）。`command` 与 `url` 只能出现一个，也不能两个都没有；其它键报配置错误。远程先走 Streamable HTTP，失败则同一组 `headers` 再试一次 SSE。启动时某个服务连不上，整个进程起不来（远程两次都失败时错误里含两种方式各自原因；`headers` 不写入错误文本）。连上后单次工具调用失败只让该次失败。两个服务给出同名工具时启动失败，错误里带工具名。`--mcp` / `--mcp-arg` 盖掉整份列表，变成一个 stdio 服务，不往后面追加 |
| `permissions.allow` | 工具名数组。写了就只有这些工具可见、可跑。命令行 `--allow`（可重复）盖掉这一项；没写 `--allow` 时用配置 |
| `permissions.deny` | 工具名数组。这些工具不可见、不可跑，并且压过 `allow`。命令行 `--deny` 盖掉这一项 |

规则：

- 省略的键 = 用「该项目形态下的内置默认」，不是强制 `false`。
- 未知顶层键、未知 capability、未知 extension → 启动失败（防拼写静默失效）。
- `capabilities` / `extensions` 本身可省略。
### 与 `tools/` 的默认交互

| 场景 | 无 config 时 coding | `"coding": true` |
| --- | --- | --- |
| 无 `tools/` | 开 | 开 |
| 有 `tools/` | 关 | 开（≡ `--builtin-tools`） |

### 合并优先级

```text
内置默认 → tah.config.json → CLI / 环境变量
```

| 能力 | 显式 CLI / env |
| --- | --- |
| coding | `--builtin-tools` 强制开 |
| exec | `--exec` / `--no-exec`（仅在传入时覆盖） |
| vision | `--vision` 或 `TAH_VISION=1` |
| mcp | `--mcp`（及 `--mcp-arg`）盖掉 config 里的整份 `extensions.mcp` |
| allow / deny | `--allow` / `--deny` 各自盖掉 config 里的同名列表；没传该 flag 时用配置。`deny` 压过 `allow` |

## 架构

```text
parseArgv → loadProject → loadTahConfig → resolveCapabilities → bootRuntime / serve
                │                              │
                └──── AGENTS.md tools/ ────────┴── 挂工具与 MCP、投影 vision
```

实现集中在 `packages/cli`：`config.ts` 负责读盘、校验与合并；`bootRuntime` 使用 resolved 结果。

## 用户视角

```json
{
  "capabilities": {
    "coding": true,
    "vision": true
  }
}
```

```sh
npx tah serve          # 有 tools/ 时仍挂内置文件工具，且开启 vision
npx tah --no-exec chat # CLI 关掉 execute_command，覆盖 config 里 coding.exec
```

`web` 默认随 `coding` 打开，`web_fetch` 和 `web_search` 都不需要 key，启动行显示 `web=on`。`web_search` 没 key 时先问 Exa、再查 Bing（查询会发给这两家，见 [工具](/guide/tools)）；想用 Tavily，key 在 `tah serve` 的 Settings → Web search 里填（存 `~/.tah/settings.json`），或写 `.env` 的 `TAVILY_API_KEY`，两者都有时 Settings 优先。

`web_fetch` 只读公网 http(s)：解析域名后拒绝回环、内网、链路本地等地址（每次重定向都重新检查，最多 5 次），20 秒超时、最多读 2MB，HTML 转成带标题 / 列表 / 链接的纯文本，默认返回前 3 万字符。

`browser` 默认随 `web` 打开，需要本机装有 Chrome。`tah serve` / `tah chat` 弹出 Chrome 窗口，`tah run` 无界面；登录状态存在 `~/.tah/browser-profile`，所有文件夹共用，同一时间只能被一个 tah 使用。打开浏览器前问一次（`--yes` 跳过），上传本机文件每次都问。

需要换搜索服务时，用 MCP：

```json
{
  "capabilities": {
    "coding": true
  },
  "extensions": {
    "mcp": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"]
    }
  }
}
```

包名与环境变量（API key 等）以所选 MCP 的说明为准。远程服务把 API key 等写在 `headers` 里。服务标签就是配置里的 url 原文，含 userinfo、query 和 hash。这个标签会出现在模型看到的工具说明里，也会出现在启动错误里。密钥放 `headers`，不要写进 url。要挂多个服务，把 `mcp` 写成数组；stdio 与 `url` 可混用。命令行 `--mcp` / `--mcp-arg` 盖掉整份列表，不追加（没有 URL 专用 CLI 参数）。工具权限写在 `permissions.allow` / `permissions.deny`（`deny` 压过 `allow`）；`--allow` / `--deny` 只盖掉自己那一项。

`tah init` 会生成示例 `tah.config.json`（仅 `coding: true`，已存在则跳过）。

## 演进

- v0.31 落地官方 `capabilities.web`（`web_search` / `web_fetch`），去掉「web: true 即报错」的守卫。
- v0.31 落地 `capabilities.browser`（内置 Playwright MCP，按需加载）。
- v0.37.8：`extensions.mcp` 可以是一个服务或一个数组；`permissions.allow` / `permissions.deny` 写进配置，命令行同名 flag 盖掉对应列表。
- 若需要用户级默认，再另开设计；不在本文件静默扩展加载路径。
- v0.28 热更新只盯 `AGENTS.md` / `tools/` / `plugins/` / `lib/`；改 `tah.config.json` 需重启进程（或再开一轮设计把它纳入 watch）。

## 文档与验收

| 项 | 说明 |
| --- | --- |
| 用法 | [CLI · 项目配置](../guide/cli.md) |
| 约定分工 | [约定式项目](./project-convention.md) |
| 验收 | 无 config 时现有测试全绿；有 config 时可持久打开 vision / mcp / coding+`tools/` |
