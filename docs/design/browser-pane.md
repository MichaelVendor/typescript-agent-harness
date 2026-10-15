# 设计说明：浏览器面板

状态：✅ 已实现（v0.36）

[内置浏览器](./browser.md) 让 Agent 操作一个真的 Chrome，但在 `tah serve` 和 macOS 客户端里，它是另弹出来的窗口：用户要来回切窗口才能看到 Agent 在干什么，登录、验证码也得去那个窗口里做。本设计参照 Claude Code 桌面版：把这个浏览器的画面放进工作台右侧面板，用户在面板里看着、也能直接接手操作；同一个面板也给用户自己预览网页和本地开发服务器。

遵循的原则（见 [设计哲学](../guide/philosophy.md)、[`tah serve`](./serve.md)）：

- 面板是给人看的界面，属于 Application 层：只改 `packages/cli`（`browser.ts`、`runtime.ts`、`host.ts`、`serve/`）和 `packages/web`；`core` / `agent` / `tools` / `mcp` 不改。
- 模型的工具不变：还是 `browser_open` 入口 + 18 个 `browser_*`；面板不新增工具。
- 前端只认协议类型，请求只走 `api.ts`；面板开关从现有工具事件推出来。
- 权限在能力边界：Agent 第一次用浏览器仍要用户批准，和用户是否已在面板里打开浏览器无关。
- 网页和 macOS 客户端表现一致，`packages/*` 不出现 Electron 代码。

## 目标

- Agent 用浏览器时，工作台右侧自动出现它的实时画面；用户能在画面里点击、滚动、打字（含中文输入法），用来接手登录、验证码。
- 用户自己也能用这个面板：对话里的 http(s) 链接、地址栏、HTML 文件预览的「在浏览器中打开」。
- 用户在面板里做过的事，Agent 下一次看页面就能看到（同一个浏览器、同一个页面）。
- `tah serve`（含 macOS 客户端）不再弹出 Chrome 窗口。

## 非目标

- `tah chat` 的面板：终端里照旧弹出可见的 Chrome 窗口；`tah run` 照旧无界面。
- 页面里的文件选择框（上传）、下载、右键菜单、拖文件进页面、和系统剪贴板互通（复制页面文字到本机）。
- `alert` / `confirm` 等页面对话框在面板里应答：照旧由 Agent 的 `browser_handle_dialog` 处理。
- 画面尺寸跟随面板宽度：浏览器固定 1280×720，按面板宽度缩放显示。
- 多个浏览器、每个文件夹各自的浏览器：一个 tah 进程同一时间只有一个（沿用内置浏览器的限制）。

## 工作方式

```
tah serve 进程
├─ browser.ts ── stdio ──> Playwright MCP ── 启动 ──> Chrome（无界面，--remote-debugging-port=0）
│     Agent 的 browser_* 工具走这条路                     │
└─ serve/screen.ts ── WebSocket（CDP，127.0.0.1） ────────┘
      截屏帧 → SSE → 网页面板；网页的点击、按键 → POST → CDP Input.*
```

- 仍由 Playwright MCP 启动 Chrome，只是通过它的配置文件给 Chrome 加 `--remote-debugging-port=0`（随机端口）。Chrome 启动后把端口写进登录目录下的 `DevToolsActivePort`，tah 读这个文件后连上去。
- 画面用 CDP `Page.startScreencast`（JPEG，页面有变化才出帧），输入用 `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`。
- 已验证（Playwright MCP 0.0.83，本机 Chrome）：调试端口能打开、端口文件能读到；另一个 CDP 连接在 Playwright 操作同一页面时能持续收到帧（1280×720 约 6KB 一帧）；通过 CDP 点击、输入后，Agent 的 `browser_snapshot` 能看到结果；Agent 新开的标签页在 CDP 里可见。
- 无界面模式下 Playwright MCP 默认空闲 1 小时关浏览器；用户只在面板里浏览时没有工具调用，所以启动时加 `--idle-timeout 0` 关掉。

## 一、`browser.ts`：启动和挂工具拆开

现在 `browser_open` 一次做完「启动 Playwright MCP」和「注册 18 个工具」。拆成两步：

| 步骤 | 谁触发 | 做什么 |
| --- | --- | --- |
| 启动 | 用户在面板里打开浏览器；或 Agent 的 `browser_open` | 起 Playwright MCP，调一次 `browser_tabs`（`action: "list"`）让它真正启动 Chrome，再读端口（启动成功说明 Chrome 已重写端口文件，不会读到旧的） |
| 挂工具 | Agent 的 `browser_open`（用户已批准） | 在同一个浏览器上注册 18 个 `browser_*` 工具 |

`createBrowser` 返回的对象加几个给应用层用的方法，插件部分不变：

```ts
type Browser = {
  plugin: Plugin;
  /** Agent 已批准、工具已挂上。 */
  agentAttached(): boolean;
  /** Playwright MCP 在运行。 */
  running(): boolean;
  /** 用户从面板启动；不挂工具。 */
  launch(): Promise<void>;
  /** CDP 端口；没运行时 undefined。 */
  cdpPort(): number | undefined;
  /** 关浏览器、收回工具。 */
  close(): Promise<void>;
};
```

浏览器对象随 host 重建（热更新、切换文件夹）而换新，所以 `serve` 不订阅它；Agent 用浏览器的变化从事件中心的 `tool.end`（`browser_*`）和 `session` 事件得知，见「三、接口」。

- Playwright MCP 参数加 `--config <file>`（内容为 `{ browser: { launchOptions: { args: ["--remote-debugging-port=0"] } } }`，写在 `~/.tah/browser-config.json`）、`--idle-timeout 0`、`--viewport-size 1280x720`。
- `headless`：`tah run` 和 `tah serve` 为无界面，只有 `tah chat` 弹窗口（`runtime.ts` 里由 `flags.command === "run"` 改为 `!== "chat"`）。
- Agent 调 `browser_close`、或用户点「关闭浏览器」：关 Playwright MCP、收回工具。Agent 之后再用浏览器要重新批准（和现在一样）。

## 二、审批（`runtime.ts`）

现在「浏览器已开着就自动放行 `browser_open`」，改成「`agentAttached()` 才自动放行」。用户先在面板里打开了浏览器，Agent 第一次调 `browser_open` 仍弹审批；批准后挂工具，之后不再问。`browser_file_upload` 照旧每次问。

`bootRuntime` 把 `browser` 一起返回，`ChatHost` 暴露 `browser?: Browser`（浏览器关闭或 `--mock` 时为 `undefined`），`serve` 通过 `workspaces.host.browser` 拿到当前文件夹的浏览器。

## 三、接口（`packages/cli/src/serve/`）

都要登录 cookie；POST 沿用 `Origin` 校验和 `application/json`。

| 接口 | 作用 |
| --- | --- |
| `GET /api/browser` | `BrowserState`：浏览器可不可用、是否在运行、Agent 是否已接入、标签页列表 |
| `GET /api/browser/stream` | SSE：`state`（`BrowserState`）和 `frame`（`{ data: base64 JPEG, width, height }`，宽高是页面的 CSS 像素） |
| `POST /api/browser/open` | `{ url?: string }`：没运行就启动；有 `url` 就在当前标签页打开 |
| `POST /api/browser/nav` | `{ action: "back" \| "reload" }` |
| `POST /api/browser/tab` | `{ id: string }`：面板切到这个标签页 |
| `POST /api/browser/input` | 鼠标、滚轮、按键、文字，见下 |
| `POST /api/browser/dialog` | `{ accept: boolean, text?: string }`：回应面板标签页的网页对话框（`text` 是 `prompt` 的回答） |
| `POST /api/browser/close` | 关闭浏览器 |

```ts
type BrowserState = {
  /** 当前文件夹开了内置浏览器（tah.config.json 的 browser 能力），且不是 --mock。 */
  available: boolean;
  running: boolean;
  agent: boolean;
  tabs: { id: string; title: string; url: string }[];
  /** 面板正在显示的标签页。 */
  active: string | null;
  /** 最近一次启动失败的原因。 */
  error?: string;
  /** 面板标签页正等着回应的网页对话框；回应前页面不接收输入。 */
  dialog?: { type: "alert" | "confirm" | "prompt" | "beforeunload"; message: string };
};

type BrowserInput =
  | { type: "mouse"; event: "move" | "down" | "up"; x: number; y: number; button: "left" | "middle" | "right" | "none"; clickCount: number; modifiers: number }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number; modifiers: number }
  | { type: "key"; event: "down" | "up"; key: string; code: string; keyCode: number; modifiers: number; text?: string }
  | { type: "text"; text: string };
```

坐标是页面 CSS 像素，网页按缩放比例换算后再发。

### 地址检查

`open` 的 `url` 只接受：

- `http:` / `https:`，但主机不能是 tah 自己（`127.0.0.1`、`localhost`、`[::1]` 加上 `tah serve` 的端口）；
- `about:blank`；
- `/preview/<预览令牌>/…`（HTML 文件预览的地址），服务端补成 `http://127.0.0.1:<端口>/preview/…`。

其他一律 400，网页在地址栏下方显示原因。

### `serve/screen.ts`（新）

- 用 Node 22 自带的 `WebSocket` 连 CDP，不加依赖。连浏览器级别的端点，`Target.setDiscoverTargets` 跟踪标签页；面板显示的标签页用 `Target.attachToTarget`（`flatten`）单独会话截屏和输入。
- 跟随规则：默认显示最新打开的标签页；新标签页出现（Agent 新开、页面弹窗如 OAuth 登录）就切过去；用户可以在下拉里切换。面板显示的标签页可能和 Agent 正在操作的不是同一个。
- 标签页标题：Chrome 在网页改标题时不发 `Target.targetInfoChanged`，所以有 `stream` 订阅时每秒用 `Target.getTargets` 重读一次，有变化才推 `state`。
- 只在至少有一个 `stream` 订阅时截屏；多个网页标签页共用一路，分发给每个。写不进去（`res.write` 返回 false）的订阅者只保留最新一帧，旧帧丢掉；收到帧立即 `screencastFrameAck`。
- 连接断开（Chrome 崩溃、浏览器关闭、切换文件夹）：推 `state`（`running: false` 或 `error`）。`serve` 订阅事件中心：收到 `browser_*` 的 `tool.end` 或 `session` 事件时同步一次——浏览器换了或不在运行就断开；在运行、还没连上、且面板开着，就重新读 `DevToolsActivePort` 再连（Playwright 重启 Chrome 后端口会变）。下一次 `open` 也会连。
- 网页对话框（`alert` / `confirm` / `prompt` / 离开页面确认）：对话框开着时 Chrome 不处理鼠标输入，面板会卡住。面板标签页收到 `Page.javascriptDialogOpening` 就把它放进 `state.dialog`，`javascriptDialogClosed` 时清掉；`/api/browser/dialog` 用 `Page.handleJavaScriptDialog` 回应。Playwright MCP 也会看到对话框已关闭，Agent 不会被卡住。
- 连 CDP（读 `/json/version`、打开 WebSocket）5 秒没连上就放弃并报错，免得 `DevToolsActivePort` 指向一个不应答的旧端口时一直转圈。挂接标签页失败时 `error` 写明原因，之后成功显示标签页就清掉。
- 输入内容不写日志、不进会话和事件流。

## 四、网页（`packages/web`）

### 布局

- 和文件预览共用右侧面板：同一个宽度（`tah.previewWidth`）、同一条分隔线、窄屏（< 900px）同样浮在对话上面。
- 文件预览和浏览器都打开时，面板顶部出现「File / Browser」切换；只开一个时不显示。
- 底部状态栏（「Compact」旁边）加「Browser」按钮（浏览器不可用时不显示），打开面板的浏览器页。
- 面板文字和网页其他部分一样用英文。

### 面板

- 工具栏：后退、刷新、地址栏（回车 = `open`）；多个标签页时出现下拉；「Open in system browser」（`window.open`）；「Close browser」。
- Agent 的 `browser_*` 工具运行中（`tool.start` 到 `tool.end`）时，工具栏显示「Agent is using the browser」。不加锁，用户随时可以操作。
- 画面：`<img>` 随 `frame` 更新，按面板宽度等比缩放。
- 输入：
  - 鼠标：按下、抬起、点击次数直接发；移动每约 30ms 发一次最新位置（悬停菜单需要），鼠标停下的位置一定发到；滚轮每约 30ms 合并发一次，只滚网页、不滚面板。
  - 输入发送失败时，错误显示在地址栏下方。
  - 键盘：画面上盖一个透明的 `<textarea>` 拿焦点。`keydown` / `keyup` 发 `key`；可打印字符由 `input` 事件整段发 `text`；输入法组字中（`isComposing`）不发，`compositionend` 后整段发 `text`。
  - 粘贴：读 `paste` 事件里的文字，发 `text`。
- 网页对话框：地址栏下方出现一条提示，显示对话框文字和「OK」（`alert` 只有它）、「Cancel」；`prompt` 多一个输入框。
- 关面板只是隐藏；「Close browser」才关 Chrome（Agent 接入了浏览器时，地址栏下方出现提示条二次确认，关掉会打断它）。
- 浏览器没运行时，面板里只有地址栏和一行说明；启动失败在地址栏下方显示 `error`，在地址栏回车即重试。

### 入口

| 入口 | 行为 |
| --- | --- |
| Agent 调 `browser_open` | 收到 `tool.start` 就打开面板并切到浏览器页。之后的 `browser_*` 不强制弹出（用户关了不再被打开） |
| 对话里的 http(s) 链接 | 点击：在面板打开（没运行就先启动，这是用户自己的操作，不需要审批）。⌘ / Ctrl 点击、或指向 tah 自己的链接：照旧新标签页 |
| HTML 文件预览 | 面板顶部加「Open in browser」，`open` 它的 `previewURL` |
| 状态栏「Browser」按钮 | 打开面板，用地址栏 |

浏览器不可用（`available: false`）时，链接照旧新标签页打开。切换文件夹、新建 / 切换会话时重新 `GET /api/browser`（浏览器跟着文件夹关闭）。

### 代码组织

| 文件 | 内容 |
| --- | --- |
| `src/browser-view.ts`（新） | 纯函数：链接走面板还是新标签页、坐标换算、键盘事件转 `BrowserInput`、Agent 是否在用浏览器 |
| `src/components/SidePanel.tsx`（新） | 右侧面板外壳：宽度、拖动、「File / Browser」切换（从 `FilePreview` 移出来） |
| `src/components/BrowserPane.tsx`（新） | 浏览器面板 |
| `src/components/FilePreview.tsx` | 「Open in browser」；外壳交给 `SidePanel` |
| `src/components/StatusBar.tsx` | 「Browser」按钮 |
| `src/components/ApprovalCard.tsx` | `browser_open` 说明改为「可在 Browser 面板里看、接手」 |
| `src/components/Messages.tsx` | http(s) 链接点击 |
| `src/App.tsx`、`styles.css` | 右侧面板切换、浏览器面板的开关 |
| `src/api.ts` | `browserState()`、`browserStream()`、`browserOpen()`、`browserNav()`、`browserTab()`、`browserInput()`、`browserDialog()`、`browserClose()` |

## macOS 客户端

不改。链接点击在网页里就被拦下，不走 Electron；「Open in system browser」用 `window.open`，沿用客户端「非本机地址用系统浏览器打开」的规则。

## 安全

- **Agent 的浏览器拿不到 tah 的登录。** 登录令牌每次启动随机生成，只出现在终端打印的链接里，Agent 拿不到；登录 cookie 名带端口，旧的失效。剩下的风险是用户把 tah 链接贴进面板：`open` 拒绝 tah 自己的地址（`/preview/` 除外）。HTML 预览本来就是不透明来源，没有登录 cookie，调不了 `/api`。
- 不靠 Playwright 的 `--blocked-origins`：它自己说明不是安全边界，且面板的导航走 CDP，不经过它。
- **调试端口** 只监听 `127.0.0.1`，端口随机。同一用户的其他本地程序能连上，但它们本来就能直接读 `~/.tah/browser-profile`，没有扩大权限。
- **接口** 和其他 `/api` 一样要登录、校验 `Origin`。
- **用户在面板里输入的内容**（包括密码）只转给 Chrome，不写日志、不进会话、不进事件流；Agent 能看到的只是输入后的页面。
- 审批规则见「二、审批」。

## 错误处理

| 情况 | 表现 |
| --- | --- |
| 登录目录被另一个 tah 占用 | 面板显示和现在相同的提示（关掉那个 tah 再试） |
| 没装 Chrome、启动失败 | 地址栏下方显示原因；在地址栏回车重试 |
| Chrome 崩溃、Playwright MCP 退出 | 面板回到「Enter a URL above to open the browser」；在地址栏回车（重新拉起 Chrome）或 Agent 下一次浏览器调用后重连 |
| 切换文件夹 | 浏览器随旧文件夹关闭，面板回到「Enter a URL above to open the browser」 |
| 地址不允许 | 400，地址栏下方显示原因 |
| 浏览器不可用（配置关闭、`--mock`） | `available: false`；面板和按钮不出现，链接新标签页打开 |
| 网页接收慢 | 丢旧帧，只发最新一帧 |

## 测试

全部用假的 Playwright MCP（沿用 `BrowserServer` 注入）和假的 CDP 连接，CI 不需要 Chrome；HOME 用临时目录，不碰真实 `~/.tah`。

- `packages/cli/test/browser.test.ts`：`launch()` 不挂工具；先 `launch()` 后 Agent `browser_open` 仍走审批；批准后同一个浏览器上挂工具；`close()` 收回工具；Playwright MCP 参数含 `--config`、`--idle-timeout 0`、`--viewport-size`；`serve` 无界面、`chat` 有界面。
- `packages/cli/test/screen.test.ts`（新）：地址检查（正例、tah 自己、`/preview/` 补全、其他协议）；输入转 CDP 命令；新标签页出现时切过去；断开后推 `state`、再连时重读端口文件；没有订阅者时不截屏。
- `packages/cli/test/serve.test.ts`：`/api/browser*` 未登录 401、跨源 403；`--mock` 下 `available: false`；`open` tah 自己的地址 400。
- `packages/web/test/browser-view.test.ts`（新）：链接分流、坐标换算、键盘和输入法转换、Agent 是否在用浏览器。
- 手动验收（临时 HOME、真 Chrome，网页和客户端各一次）：
  1. 状态栏「Browser」打开 `https://example.com`，点击链接、滚动、在搜索框输入中文。
  2. 让 Agent 打开一个网页：审批弹出，批准后面板自动出现，能看到它操作。
  3. 在面板里点一下页面，再让 Agent 描述页面，它看到了变化。
  4. 对话里点一个 `http://localhost:<开发服务器>` 链接，在面板打开。
  5. HTML 文件预览「Open in browser」，Agent 能看到这个页面。
  6. 在面板地址栏输入 tah 自己的地址，被拒绝。

## 文件

| 文件 | 改动 |
| --- | --- |
| `packages/cli/src/browser.ts` | 启动 / 挂工具拆开，`Browser` 新方法，Playwright MCP 参数 |
| `packages/cli/src/runtime.ts` | `headless` 规则、审批改用 `agentAttached()`、返回 `browser` |
| `packages/cli/src/host.ts` | `ChatHost.browser` |
| `packages/cli/src/serve/screen.ts`（新） | CDP 连接、截屏分发、输入、地址检查 |
| `packages/cli/src/serve/http.ts` | `/api/browser*` 路由 |
| `packages/cli/src/serve/protocol.ts` | `BrowserState`、`BrowserInput`、请求体类型 |
| `packages/cli/src/index.ts` | 导出新类型 |
| `packages/web/**` | 见「代码组织」 |
| `docs/design/browser.md` | `tah serve` 不再弹窗口，画面在面板 |
| `docs/design/serve.md` | 接口表、安全小节 |
| `CHANGELOG.md`、`docs/guide/roadmap.md` | 条目 |

## 已定决策

| 问题 | 决定 |
| --- | --- |
| 参照 | Claude Code 桌面版的浏览器面板 |
| 用途 | Agent 的浏览器（看、接手）和用户自己的网页预览，同一个面板 |
| 平台 | 网页和 macOS 客户端都有，用截屏流 + 输入转发；不用 Electron `webview`（Agent 的 CDP 能碰到 tah 页面） |
| 谁启动 Chrome | 仍由 Playwright MCP 启动并打开调试端口（方案 B）；不改成 tah 自己启动再让 Playwright 连接（方案 A） |
| 审批 | 用户先在面板打开浏览器，Agent 第一次用仍要批准 |
| 入口 | Agent 用浏览器时自动打开；对话里所有 http(s) 链接；HTML 文件预览；地址栏 |
| 传输 | 帧走单独的 SSE，输入走 POST；不加 WebSocket 服务端 |
| 画面尺寸 | 固定 1280×720，缩放显示 |
| `tah chat` / `tah run` | 不变 |
