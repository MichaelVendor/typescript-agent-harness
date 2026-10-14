# 设计说明：文件预览

状态：📐 已设计

Agent 写了报告、改了图片、生成了网页，用户现在只能自己去文件夹里找。本设计参照 Claude Code 桌面版：对话里出现的文件路径可以点，在工作台右侧的面板里预览。

遵循的原则（见 [设计哲学](../guide/philosophy.md)、[`tah serve`](./serve.md)）：

- 预览是给人看的界面，属于 Application 层：只改 `packages/cli/src/serve`、`host.ts` 和 `packages/web`；`core` / `agent` / `tools` 不改，也不给模型加工具。
    10|- 前端只认协议类型，请求只走 `api.ts`。
- 权限在能力边界：接口只读、只限当前工作文件夹，和内置文件工具的边界一致。
- 网页和 macOS 客户端表现一致，`packages/*` 不出现 Electron 代码。

## 目标

- 点对话里的文件路径，在右侧面板预览：图片、PDF、视频、HTML 直接渲染；Markdown 渲染；代码和文本高亮显示。
- HTML 里相对路径引用的 CSS、JS、图片能加载，脚本能运行，外网资源（CDN）能加载。
- 预览中的文件被 Agent 改了，面板自动更新，不显示旧内容。

## 非目标

- 编辑、保存。
- 文件树、diff 查看。
- 预览工作文件夹以外的文件（包括 Agent 写到 `/tmp` 的文件）。
- 同时预览多个文件（标签页）。
- 应用内浏览器面板：另见 `browser-pane.md`（单独设计）。
- TUI。

## 接口（`packages/cli/src/serve/`）

| 接口 | 鉴权 | 作用 |
| --- | --- | --- |
| `GET /api/files/stat?path=…` 或 `?attachment=<id>` | 登录 cookie | `{ path, kind, bytes, mtime, previewURL? }` |
| `GET /api/files/raw?path=…&v=<mtime>`（或 `attachment=<id>`） | 登录 cookie | 文件原始字节 |
| `GET /preview/<预览令牌>/<相对路径>` | 预览令牌 | HTML 及其引用的同文件夹资源 |

### 路径规则

- `path` 是相对当前工作文件夹（`workspaces.cwd`）的路径，或落在其中的绝对路径。
- 文件和工作文件夹都先 `realpath` 再比较，软链接指向外面也算出界。
- 出界、不存在、是目录：一律 404 `{ error: "not found in this folder" }`，不区分原因。
- `attachment=<id>` 用当前文件夹的附件存储按 id 找到文件；事件里的附件仍不带本机路径。
- 切换文件夹后，只认新文件夹；旧文件夹的路径 404。

### `kind`

按扩展名判断：

| kind | 扩展名 |
| --- | --- |
| `image` | `png` `jpg` `jpeg` `gif` `webp` `svg` `ico` `bmp` |
| `pdf` | `pdf` |
| `video` | `mp4` `webm` `mov` |
| `html` | `html` `htm` |
| `markdown` | `md` `markdown` |
| `text` | 常见代码与文本扩展名（`ts` `tsx` `js` `json` `css` `py` `sh` `yaml` `toml` `txt` `log` `csv` …），以及没有扩展名的文件 |
| `binary` | 其他 |

不认识的扩展名读前 8KB：没有零字节算 `text`，有就算 `binary`。只有 `html` 返回 `previewURL`（`/preview/<令牌>/<相对路径>`）。

### `raw` 响应

- `Content-Type` 按扩展名（未知文本用 `text/plain; charset=utf-8`，未知二进制用 `application/octet-stream`）；`X-Content-Type-Options: nosniff`；`Cache-Control: no-cache`。
- 除 PDF 外都带 `Content-Security-Policy: sandbox`：被直接打开（比如 SVG、HTML）时也不能运行脚本。PDF 不带，否则浏览器自带的 PDF 查看器不工作。
- 支持单段 `Range: bytes=a-b` / `a-` / `-n`，返回 206 和 `Content-Range`；不合法或越界 416。视频拖动进度要用。
- 流式发送，不把整个文件读进内存。

### `/preview/<令牌>/…`

- 预览令牌每次启动用 `crypto.randomBytes(32)` 生成（base64url），与登录令牌分开，比较用 `timingSafeEqual`；令牌不对 404。
- 路径规则同上（相对当前工作文件夹），所以 HTML 里 `./style.css`、`../img/a.png` 都能正常加载，只要还在文件夹内。
- 响应头：`Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals`、`nosniff`、`Cache-Control: no-cache`。
- sandbox 里没有 `allow-same-origin`，页面是「不透明来源」：浏览器把它的请求当作跨站，`SameSite=Strict` 的登录 cookie 不会带上；`/api` 的 POST 因为 `Origin` 不对被拒，GET 读不到响应。

### 协议改动（`host.ts`）

`tool.start`、`tool.end` 事件和 `HistoryItem` 的工具条目加可选字段 `path?: string`：只有 `read_file`、`write_file`、`edit_file`、`read_image_text` 带，值是工具参数里的完整 `path`。`summary` 照旧截到 60 字符，只用来显示。TUI 不用这个字段。

## 网页（`packages/web`）

### 布局

- 主区域右侧的预览面板，和消息流左右分栏；分隔线可拖动，宽度存在 `localStorage`。
- 面板顶部：文件路径、「渲染 / 源码」切换（只有 HTML 有）、刷新、关闭。
- 一次只预览一个文件；点另一个路径就替换。
- 窗口宽度小于 900px 时，面板盖在消息流上面。
- 切换文件夹、新建 / 切换会话时关闭面板。

### 入口

| 位置 | 规则 |
| --- | --- |
| 工具行 | 带 `path` 的工具行，路径可点 |
| 用户消息的附件卡片 | 可点，按附件 `id` 打开 |
| 助手正文的 Markdown 链接 | 目标不是 `scheme:` 开头（`http:`、`https:`、`mailto:` 等）也不是 `#` 锚点时，当作文件路径 |
| 助手正文的行内代码 | 不含空白和括号，且含 `/` 或以 `kind` 表里的扩展名结尾时，当作文件路径 |

渲染时不请求服务端确认文件是否存在。点击后调 `stat`：404 时面板显示「在当前文件夹里找不到这个文件」，不在消息流里报红色错误。路径末尾的 `:行号` 去掉后再查。

### 各类型的显示

| kind | 显示 |
| --- | --- |
| `image` | `<img>`（SVG 也用 `<img>`，脚本不运行） |
| `pdf` | `<iframe>`，浏览器自带的 PDF 查看器 |
| `video` | `<video controls>` |
| `html` | 渲染：`<iframe src={previewURL} sandbox="allow-scripts allow-forms allow-popups allow-modals">`（和服务端 CSP 双重保护）；源码：按 `text` 显示 |
| `markdown` | 和对话相同的渲染（不渲染原始 HTML）；相对路径的图片改写成 `/api/files/raw` 地址 |
| `text` | 按扩展名选语言高亮；超过 256KB 不高亮；超过 1MB 只显示前 1MB，并提示「文件太大，只显示开头」 |
| `binary` | 「无法预览」和文件大小 |

### 刷新

- 面板打开时，收到 `tool.end`：`write_file` / `edit_file` 且 `path` 指向当前文件，或任何 `execute_command`，就重新 `stat`。
- `mtime` 变了才重新加载内容；`raw` 和 `previewURL` 都带 `v=<mtime>`，不会拿到旧缓存。
- 刷新按钮无条件重新加载。
- `stat` 404：面板显示「文件已被删除」。

### 代码组织

| 文件 | 内容 |
| --- | --- |
| `src/preview-view.ts`（新） | 纯函数：判断行内代码 / 链接是不是路径、去掉 `:行号`、Markdown 图片地址改写、哪些事件触发刷新 |
| `src/components/FilePreview.tsx`（新） | 面板 |
| `src/components/Messages.tsx`、`ToolLine.tsx` | 路径可点 |
| `src/App.tsx`、`styles.css` | 分栏布局 |
| `src/api.ts` | `fileStat()`、`fileRawURL()` |

## macOS 客户端

不改。面板是网页的一部分，客户端窗口里同样可用；HTML 预览里打开外部链接，沿用客户端「非本机地址用系统浏览器打开」的规则。

## 安全

- 三个接口都只读，只限当前工作文件夹，沿用 `Host` 校验。
- HTML 预览会运行页面里的脚本，脚本能用预览令牌读这个工作文件夹里的其他文件，也能访问外网。打开文件夹本来就要信任它（会执行其中的 `tools/`、`plugins/`），只预览信任的 HTML。
- 脚本拿不到登录 cookie，不能调 `/api`，不能批准命令。
- `/preview` 不受登录保护，只靠令牌；令牌随 `tah serve` 重启失效。

## 错误处理

| 情况 | 表现 |
| --- | --- |
| 出界、不存在、是目录 | 404；面板「在当前文件夹里找不到这个文件」 |
| 未登录 | 401，沿用现有登录提示 |
| 预览令牌不对 | 404 |
| `--no-persist` | 照常可用 |
| 预览中文件被删 | 面板「文件已被删除」 |
| `Range` 不合法或越界 | 416 |
| 读文件中途出错 | 断开连接；面板显示加载失败，可点刷新 |

## 测试

- `packages/cli/test/serve.test.ts`（`--mock --port 0` 起真实服务）：
  - 未登录 401；文件夹内文件 200；
  - `../` 出界、文件夹外的绝对路径、指向外面的软链接、目录：都 404；
  - `kind`：按扩展名；未知扩展名按零字节判断；
  - `attachment=<id>` 能读到；
  - `raw` 的 `Content-Type`、`nosniff`、CSP（PDF 不带 sandbox）；
  - `Range`：206 与 `Content-Range`；不合法 416；
  - `/preview`：错误令牌 404；正确令牌能读到 HTML 和同目录 CSS，带 sandbox CSP；
  - 切换文件夹后旧路径 404。
- `packages/cli/test/host.test.ts`：四个文件工具的事件和历史带完整 `path`，其他工具不带。
- `packages/web/test/preview-view.test.ts`：路径识别（正例、反例）、`:行号`、Markdown 图片改写、刷新判断。
- 手动验收（网页和客户端各一次）：
  1. 点工具行、附件卡片、正文里的路径，分别打开图片、PDF、视频、Markdown、代码。
  2. 打开一个引用相对 CSS 和外网 CDN 图表库的 HTML，样式和图表正常。
  3. 让 Agent 修改正在预览的文件，面板自动更新。
  4. HTML 里的脚本 `fetch("/api/sessions")` 失败。
  5. 点一个文件夹外的路径，面板提示找不到。

## 文件

| 文件 | 改动 |
| --- | --- |
| `packages/cli/src/serve/files.ts`（新） | 路径解析、`kind`、`raw` 流式发送与 `Range` |
| `packages/cli/src/serve/http.ts` | 三个路由；`createServeHandler` 里生成预览令牌（测试从 `stat` 的 `previewURL` 拿到） |
| `packages/cli/src/serve/protocol.ts` | `FileStat` 类型 |
| `packages/cli/src/host.ts` | 工具事件与历史的 `path` |
| `packages/cli/src/index.ts` | 导出 `FileStat` |
| `packages/web/**` | 见「代码组织」 |
| `docs/design/serve.md` | 接口表、安全小节补上新接口 |
| `CHANGELOG.md` | Unreleased 条目 |

## 已定决策

| 问题 | 决定 |
| --- | --- |
| 参照 | Claude Code 桌面版的文件面板（去掉编辑） |
| 编辑 | 不做，只读；外部改动后自动刷新 |
| 入口 | 只从对话里的路径打开；不做文件树 |
| 可读范围 | 只限当前工作文件夹（含 `.tah/attachments`） |
| HTML | 同端口、`/preview/<令牌>/` 路径、sandbox 不透明来源；允许脚本和外网资源 |
| 模型 | 不参与，不新增工具 |
