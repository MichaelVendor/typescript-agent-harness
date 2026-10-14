# 设计说明：内置浏览器（Playwright MCP）

状态：✅ 已实现（随 **`v0.31`** 发布）

v0.36 起 `tah serve` 不再弹出 Chrome 窗口，画面在网页的[浏览器面板](./browser-pane.md)里。

`web_fetch` 只拿服务器返回的 HTML，不跑 JS，也不能点击、登录。本设计内置 [Playwright MCP](https://github.com/microsoft/playwright-mcp)，让 Agent 像 Cursor 的浏览器工具那样操作一个真的 Chrome。

## 背景

- `extensions.mcp` 早就能挂第三方 MCP，但 `packages/mcp` 的 stdio 客户端用 `Content-Length` 分帧（LSP 风格），而 MCP 标准的 stdio 传输是「每行一条 JSON」。测试用的假服务器也是 `Content-Length`，所以测试通过、真服务器（包括 Playwright MCP）都连不上。
- Playwright MCP（`@playwright/mcp` 0.0.83）有 25 个工具，工具说明合计约 2 万字符；每轮请求都带上太贵。
- 它的 `browser_take_screenshot` 默认把图片以 base64 放进结果；原样进对话会撑爆上下文，DeepSeek 等模型也看不了图。

## 目标

- 默认可用、平时零开销：只挂一个小入口工具 `browser_open`，模型调用后才启动浏览器、挂上完整的浏览器工具（同 Cursor 的按需加载）。
- 打开浏览器前问一次用户；之后的操作不再问，上传本机文件除外。
- `tah chat` 弹出可见的 Chrome 窗口；`tah serve` 在浏览器面板里显示画面（v0.36）；`tah run` 用无界面模式。
- 登录状态保存在 `~/.tah/browser-profile`，所有文件夹共用。
- 修好 MCP stdio 客户端，用户自己的 `extensions.mcp` 也能连真服务器。

## 非目标

- 截图交给模型看（vision）：放第二步，见文末「后续」。
- 连接用户平时用的 Chrome（`--extension` 模式）、复用它的登录。
- 多个浏览器并行：一个 tah 进程同一时间只有一个浏览器（同一个登录目录只能被一个 Chrome 用）。
- 网页里显示截图、浏览器设置页。
- 自动处理验证码、登录：提示词要求模型遇到时停下来交给用户。

## 安装

`@playwright/mcp` 作为 `packages/cli` 的依赖，锁定版本（0.0.83），解压后约 19MB（含 `playwright` / `playwright-core`）。用本机已装的 Chrome（`--browser chrome`），不另外下载浏览器。启动时用 `node <require.resolve("@playwright/mcp/cli.js")>`，不走 npx，离线可用。

本机没有 Chrome 时，`browser_open` 报错，Playwright 的错误原文交给模型。

## 一、MCP 客户端修复（`packages/mcp`）

| 项 | 改动 |
| --- | --- |
| 分帧 | 发送：`JSON + "\n"`；接收：按行切分，空行跳过，解析失败的行忽略 |
| 测试假服务器 | `test/fixtures/ping-server.mjs` 改成按行收发 |
| 结果转换 | `tools/call` 返回 `{ content: [...], isError? }`：`text` 部分用换行拼成字符串作为工具结果；`image` 部分不进对话，换成一行 `[image omitted]`；`isError: true` 时抛出该文字作为工具错误 |
| 进程退出 | 现有行为不变：等待中的请求全部报错 |

修好后 `extensions.mcp` / `--mcp` 接的第三方服务器同样受益。

## 二、浏览器插件（`packages/cli/src/browser.ts`）

### 开关

| 来源 | 规则 |
| --- | --- |
| 默认 | 跟随 `capabilities.web`（`web` 又跟随 `coding`） |
| `tah.config.json` | `capabilities.browser: false` 关掉；`true` 打开 |
| `--mock` | 不挂（测试和演示不启动浏览器） |

开着时启动行显示 ` browser=on`。

### 入口工具 `browser_open`

- 输入 `{ url?: string }`。
- 浏览器没开：启动 Playwright MCP 进程，`tools/list` 后把白名单里的工具注册进工具表；有 `url` 就接着调用 `browser_navigate`。返回 `{ opened: true, tools: [...] }` 和导航结果。
- 浏览器已开：不重启；有 `url` 就导航，没有就停在当前页面。
- 启动时先调一次 `browser_tabs`（`action: "list"`），让 Chrome 立刻启动（Playwright MCP 在第一次工具调用时才启动 Chrome）；没给 `url` 就停在当前页面。
- agent loop 每次请求前都重新读工具表（`listSchemas()`），所以新工具在下一步就能被模型看到。

启动参数：

| 参数 | 值 |
| --- | --- |
| `--browser` | `chrome` |
| `--user-data-dir` | `~/.tah/browser-profile` |
| `--output-dir` | `<cwd>/.tah/browser`（截图等输出） |
| `--image-responses` | `omit`（不回传图片） |
| `--headless` | `tah run` 和 `tah serve`；只有 `tah chat`（含 `--plain`）弹出窗口 |
| `--config` | `~/.tah/browser-config.json`：Chrome 加 `--remote-debugging-port=0`，给浏览器面板用（v0.36） |
| `--idle-timeout` | `0`：无界面时不因空闲关浏览器（用户可能只在面板里浏览） |
| `--viewport-size` | `1280x720` |
| 进程 cwd | 当前工作文件夹（Playwright 默认只允许访问这个目录下的文件） |

### 挂哪些工具（18 个）

挂：`browser_navigate`、`browser_navigate_back`、`browser_snapshot`、`browser_find`、`browser_click`、`browser_type`、`browser_fill_form`、`browser_select_option`、`browser_press_key`、`browser_hover`、`browser_drag`、`browser_wait_for`、`browser_tabs`、`browser_take_screenshot`、`browser_handle_dialog`、`browser_file_upload`、`browser_console_messages`、`browser_close`。

不挂：`browser_run_code_unsafe`、`browser_evaluate`（执行任意代码）、`browser_network_requests` / `browser_network_request`、`browser_emulate_media`、`browser_resize`、`browser_drop`。

### 结果大小

浏览器工具的文字结果超过 30000 字符时截断，末尾加 `[truncated: N more chars — use browser_find to search the page]`。

### 生命周期

- 一个 tah 进程（`tah serve` 里是一个文件夹的 host）只有一个浏览器。
- `browser_close` 关掉页面后，浏览器工具从工具表里撤下，下次需要再调用 `browser_open`（会再问一次）。用户手动关掉 Chrome 窗口不特别处理：下一次浏览器工具调用的结果（Playwright MCP 重新打开窗口或报错）原样交给模型。
- runtime 停止（退出、热更新、`tah serve` 切换文件夹）时结束 Playwright MCP 进程，浏览器随之关闭。
- `~/.tah/browser-profile` 被另一个 tah 进程占用时，`browser_open` 关掉刚启动的 Playwright MCP、撤下工具，报错 `the browser profile … is in use by another tah — close that tah (or its browser) and try again`。

## 三、审批

| 工具 | 规则 |
| --- | --- |
| `browser_open` | Agent 还没接入时需要审批（用户先在浏览器面板里打开了浏览器也一样）；接入后自动放行 |
| `browser_file_upload` | 每次都要审批（读本机文件） |
| 其他浏览器工具 | 不问 |

实现：两者加入 `APPROVAL_TOOLS`；CLI 传给 `approvalPlugin` 的 `ask` 先判断「是 `browser_open` 且 Agent 已接入（`agentAttached()`）」就直接返回 `yes`，不改 `packages/permissions`。`--yes` 照常全部跳过。

审批卡片：`browser_open` 显示「Open browser」和网址；`browser_file_upload` 显示文件路径。

和「每个会话问一次」的差别：浏览器开着时换会话可以直接用，不会再问；浏览器关掉后再打开会再问。

## 四、截图

`--image-responses omit` 下，`browser_take_screenshot` 只返回文字（含保存路径，在 `.tah/browser/` 下）。提示词告诉模型：理解页面用 `browser_snapshot` / `browser_find`，截图只用于留存给用户看。

## 五、提示词

`web` 规则后追加：读静态网页用 `web_fetch`；需要点击、填表、登录，或页面靠 JS 渲染读不到内容时，先 `browser_open`。遇到登录、验证码、支付或需要人工确认的操作，停下来告诉用户在那个浏览器里自己完成（`tah chat` 是弹出的窗口，`tah serve` 是浏览器面板）。

## 六、显示

| 工具 | `summary` | `result` |
| --- | --- | --- |
| `browser_open` | 网址 | `opened` / `already open` |
| `browser_navigate` | 网址 | 页面标题 |
| 其他 `browser_*` | 有 `element` 参数时显示元素描述，否则参数 JSON（截到 60 字符） | 页面标题，没有标题时显示字符数 |

## 测试

- `packages/mcp`：按行收发的假服务器；结果转换（text 拼接、image 省略、`isError` 抛错）。
- `packages/cli`：用假 MCP 服务器代替 Playwright（可注入启动命令），测 `browser_open` 前后工具表变化、Agent 已接入时自动放行、`browser_close` 后撤下工具、截断、`capabilities.browser: false`、`--mock` 不挂。
- 端到端（手动，临时 HOME）：真 Playwright 打开本机测试页，点击、输入、读快照；`tah serve` 里弹出窗口并批准；`tah run` 无界面。

## 后续

- 截图交给 vision 模型：开了 vision 时，在工具结果之后追加一条带图片的 user 消息（OpenAI 格式不允许工具消息带图片），需要改 agent loop。
- 网页对话里显示截图缩略图。
