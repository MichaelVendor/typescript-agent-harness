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
- 细粒度 `--allow` / `--deny`、`maxSteps`、`persist`、模型与 API key（仍 flag / `.env`）
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
    "mcp": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  }
}
```

| 键 | 含义 |
| --- | --- |
| `capabilities.coding` | `true` / `false`，或 `{ "exec": boolean }`（默认 `exec: true`）。挂 `list_files` / `read_file` / `grep` / `write_file`，以及可选的 `execute_command` |
| `capabilities.web` | 预留官方 `web_search` / `web_fetch`。**v0.28 未实现**：写 `true` 会启动失败。需要上网或浏览器时用 `extensions.mcp`（见下），不要开 `web` |
| `capabilities.vision` | `tah serve` 图片多模态投影（同 `--vision` / `TAH_VISION=1`） |
| `extensions.mcp` | `{ "command": string, "args"?: string[] }`，stdio MCP（同 `--mcp` / `--mcp-arg`）。**当前推荐**用来接搜索、抓取、浏览器类第三方 MCP |

规则：

- 省略的键 = 用「该项目形态下的内置默认」，不是强制 `false`。
- 未知顶层键、未知 capability、未知 extension → 启动失败（防拼写静默失效）。
- `capabilities` / `extensions` 本身可省略。
- 无内置浏览器自动化工具；完整点选 / 截图等靠 MCP 或自写 `tools/`。

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
| mcp | `--mcp`（及 `--mcp-arg`）覆盖 config 里的 `extensions.mcp` |

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

需要搜索或浏览器时，保持 `"web": false`（或省略），用 MCP：

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

包名与环境变量（API key 等）以所选 MCP 的说明为准；也可用命令行 `--mcp` / `--mcp-arg` 临时挂上。

`tah init` 会生成示例 `tah.config.json`（仅 `coding: true`，已存在则跳过）。

## 演进

- 官方 `capabilities.web`（`web_search` / `web_fetch`）落地后，去掉「web: true 即报错」的守卫；在此之前以 MCP 为准。
- 内置浏览器自动化不在本阶段范围。
- 若需要用户级默认，再另开设计；不在本文件静默扩展加载路径。
- v0.28 热更新只盯 `AGENTS.md` / `tools/` / `plugins/` / `lib/`；改 `tah.config.json` 需重启进程（或再开一轮设计把它纳入 watch）。

## 文档与验收

| 项 | 说明 |
| --- | --- |
| 用法 | [CLI · 项目配置](../guide/cli.md) |
| 约定分工 | [约定式项目](./project-convention.md) |
| 验收 | 无 config 时现有测试全绿；有 config 时可持久打开 vision / mcp / coding+`tools/` |
