# 免 key 的 web_search 设计

## 背景

`web_search` 现在只走 Tavily，没配 key 就不挂，agent 只剩 `web_fetch`，提示词还会让它找用户要 key。目标：**不配任何 key，`web_search` 开箱可用**；配了 Tavily key 的用户行为不变。

## 调研结论（2026-10-15，在用户网络上实测）

| 来源 | 结果 |
| --- | --- |
| Exa 托管 MCP `https://mcp.exa.ai/mcp`（免 key，限流） | ✅ 约 2.6 秒，结果带正文摘录 |
| Bing 结果页 `www.bing.com/search` | ✅ 1～2 秒，10 条，中文正常；链接是 `bing.com/ck/a?…&u=a1<base64url>`，可还原 |
| DuckDuckGo HTML / 百度 / 搜狗（直接请求） | ❌ 反爬 |
| `open-websearch`（npm） | 默认 Bing 在本网络失败、依赖重、冷启动安装约 3 分钟；不内置，只在文档里作为可选 MCP |

业内对照：Claude Code / Codex / Gemini CLI 用模型厂商服务端搜索（DeepSeek 没有）；OpenCode 免 key 直连 Exa 托管 MCP；Python 生态用 `ddgs` 抓多引擎。

## 方案

`web_search` 按顺序选后端：

1. **配了 Tavily key** → Tavily，失败直接报错（与现在一致，不回退）。
2. **没 key** → Exa；Exa 失败或 0 条 → Bing。
3. Bing 也失败或 0 条 → 报错，错误信息带两边原因，并建议 `browser_open https://www.bing.com/search?q=…`。

全程是普通 HTTP 请求，不开浏览器，不加依赖。

### Exa

- `POST https://mcp.exa.ai/mcp`，头 `content-type: application/json`、`accept: application/json, text/event-stream`。
- 请求体：`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_search_exa","arguments":{"query":…,"numResults":max}}}`。
- 响应可能是 SSE（取 `data: ` 行）或纯 JSON；`result.content[0].text` 里各条结果用 `\n\n---\n\n` 分隔，每条形如 `Title: …\nURL: …\n…\nHighlights:\n<摘录>`。
- 视为失败：非 2xx、超时（10 秒，给 Bing 留时间）、JSON-RPC `error`、`result.isError`、解析出 0 条。

### Bing

- `GET https://www.bing.com/search?q=<query>&count=<max>`，浏览器 `User-Agent`，`Accept-Language: zh-CN,zh;q=0.9,en;q=0.8`，跟随跳转（国内会跳 `cn.bing.com`）。
- 每个 `<li class="b_algo"…>`：标题和链接取 `h2 > a`，摘要取第一个 `<p>`；去标签、用现有 `decodeEntities` 解实体。
- 链接若是 `bing.com/ck/a`，取 `u` 参数去掉 `a1` 前缀后按 base64url 解码；解不出或不是 http(s) 的丢掉；按 URL 去重；取前 `max` 条。
- 超时沿用 `TIMEOUT_MS`（20 秒）。

### 输出

保持 `{ query, results: [{ title, url, content }] }`，`content` 仍截到 1000 字；新增 `engine: "tavily" | "exa" | "bing"`，让模型和日志知道实际走了哪个后端。

## 改动范围

| 文件 | 改动 |
| --- | --- |
| `packages/tools/src/web-tools.ts` | `WebSearchOptions` 改为 `{ apiKey?: string; endpoint?: string; exaEndpoint?: string; bingEndpoint?: string }`（后三个仅测试用）；拆出 `searchTavily` / `searchExa` / `searchBing` 三个函数，`execute` 按上面顺序调用；工具描述去掉「(Tavily)」 |
| `packages/cli/src/runtime.ts` | `capabilities.web` 开着就挂 `webSearchTool({ apiKey: webKey })`（含 `--mock`）；启动日志恒为 `web=on` |
| `packages/cli/src/prompt.ts` | `web` 只剩 `"search" \| "off"`，删掉 `fetch` 那条规则 |
| `packages/cli/src/serve/protocol.ts` | `search: null` 的含义改为「没 key，用 Exa + Bing」 |
| `packages/web/src/components/Settings.tsx` | 没 key 时显示「Exa + Bing · no key needed · On」卡片；说明改为「开箱可用，查询会发给 Exa / Bing；填 Tavily key 则改用 Tavily」；输入框标签加 `(optional)` |
| 文档 | `docs/guide/tools.md`、`docs/design/config.md`（`capabilities.web` 一行）、`docs/guide/status.md`、`docs/guide/roadmap.md`、`CHANGELOG.md`；`tools.md` 写明查询会发给 Exa（第三方），并给一段 `open-websearch` 的 `extensions.mcp` 示例 |

不改：`settings.ts` 的 Tavily key 存取、`host.ts` 的结果摘要、版本号（另行发版）。

## 测试

`packages/tools/test/web.test.ts`，全部用本地 HTTP 服务，不访问外网：

1. Exa 正常：SSE 响应、两条结果 → `engine: "exa"`、标题/URL/摘录正确、`numResults` 等于截断后的 `max_results`、摘录截到 1000 字。
2. Exa 返回 `isError` / 500 → 回退 Bing：样例页含两条 `ck/a` 链接（一条重复）和一条非 http 链接 → `engine: "bing"`、URL 已还原、去重、过滤。
3. Exa 和 Bing 都失败 → 报错信息含两边原因和 `browser_open`。
4. 有 `apiKey` → 只请求 Tavily，Exa / Bing 服务收不到请求；现有 Tavily 测试保留。

`packages/cli/test/config.test.ts`：把「web_search 需要 Tavily key」改为没 key 也挂 `web_search`、启动日志 `web=on`。

手动验收：`tah run` 真实搜一次中文、一次英文，确认走 Exa；把 `exaEndpoint` 指到不可达地址再搜一次，确认回退 Bing。

## 风险

- Exa 免 key 额度未公开、可能随时调整 → Bing 兜底。
- Bing 改版或弹验证码 → 解析出 0 条时报错并提示 `browser_open`，不静默返回空结果。
- 查询内容会发给 Exa / Bing → 文档和 Settings 里写明。
