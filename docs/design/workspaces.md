# 设计说明：`tah serve` 工作文件夹（Workspaces）

状态：📐 已设计（计划随 **`v0.30`** 发布）

对齐 Cursor 侧边栏的 Workspaces：一个网页工作台管理多个项目目录，每个目录下挂自己的 sessions。

## 背景

`tah serve` 目前绑定启动时的单个 `cwd`：会话库 `.tah/cli.db`、文件 / 命令工具、`AGENTS.md` / `tools/` / `skills/`、`tah.config.json`、热更新、附件都以它为根。想在另一个项目里用 Agent，只能另开终端另起一个 `serve`。

## 目标

- 网页侧边栏按「工作文件夹」分组显示 sessions；顶部一个跨文件夹的 Pinned 区。
- 网页里用目录浏览器添加文件夹，也能就地新建文件夹。
- 点另一个文件夹的 session（或在它下面新建 session）即切过去，Agent 的工作目录跟着变。
- 文件夹列表跨 `serve` 重启保留。

## 非目标

- 多个文件夹并行跑：同一时间仍只有一个当前 session（和现在一样）；跑着的时候不能切。
- 每个文件夹各自的 `.env`：API key 仍来自启动 `serve` 时加载的 `.env`，所有文件夹共用。
- `tah chat` / TUI / `tah sessions` 的多文件夹支持：它们照旧单 `cwd`。
- 文件夹重排序、重命名分组显示名、远程目录。
- 目录浏览器显示文件或文件内容：只列子文件夹名。

## 数据

### 文件夹列表：`~/.tah/workspaces.json`

```json
{ "workspaces": ["/Users/me/proj-a", "/Users/me/proj-b"] }
```

- 绝对路径数组，顺序 = 加入顺序 = 侧边栏顺序；去重按 `path.resolve` 后的字符串。
- `tah serve` 启动时把自己的 `cwd` 加进去（已在则不动）。
- 「移除」只从列表里删，不碰磁盘上的任何文件；当前文件夹不能移除。
- 文件读不了 / 不是合法 JSON / 字段类型不对 → 当空列表（与 `session-flags.json` 同样宽容）。
- 模块：`packages/cli/src/workspaces.ts`（`loadWorkspaces(home)` / `addWorkspace(home, dir)` / `removeWorkspace(home, dir)`；`home` 可注入，测试不碰真实 `~`）。

### 每个文件夹自己的数据（不变）

`<dir>/.tah/cli.db`、`session-titles.json`、`session-flags.json`。置顶 / 归档仍记在会话所在文件夹里；「跨文件夹 Pinned 区」只是前端把各文件夹的 pinned 汇总显示。

## 后端

### 工作区管理：`serve/workspaces.ts`

持有当前文件夹与它的 `ChatHost`，对 HTTP 层提供：

- `active`：当前 `{ cwd, host }`。
- `activate(dir)`：
  1. `hub.assertIdle()`；`dir` 已是当前 → 什么都不做。
  2. `createChatHost({ ...flags, cwd: dir, session: "" })`（`--session` 只属于启动目录），暂存它的事件后 `open()`；失败 → 关掉新 host，抛错（HTTP 400），**旧文件夹保持当前、不受影响**。
  3. 成功 → `hub.swap(newHost, buffered)`，关闭旧 host，`active` 指向新的。
- `list()`：遍历 `workspaces.json`：
  - 当前文件夹 → `host.listSessions()`；
  - 其它文件夹 → 不启动模型，直接只读它的 `.tah/cli.db` 得到 `SessionRow[]`（复用 `tah sessions` 的读取逻辑：把 `listSavedSessions` 拆出一个返回行的函数）；没有 db → 空列表；
  - 目录不存在 → `missing: true`、空列表；某个文件夹读失败 → 该组 `error` 字段带原因、空列表，其它组不受影响。
- 非当前文件夹的「改名 / 置顶 / 归档」：直接写那个文件夹的 `session-titles.json` / `session-flags.json`（先从它的 db 确认 session 存在），不切换。

### 多标签页同步：`hub.swap(host, buffered)`

- 退订旧 host，清掉回放缓存（startup notices、`base` session、`lastEnd`、当前 turn），订阅新 host。
- 已连着的标签页不断开；新 host `open()` 后发出的 `session` 事件经 hub 推给所有标签页，前端照常处理。
- 因为 `open()` 在 `swap` 之前（失败时 hub 不能已经指向坏掉的 host），管理器在 `open()` 前先 `newHost.on(...)` 把它发出的事件（启动 notice、`session`）暂存；成功后调用 `hub.swap(newHost, buffered)`，hub 把这些事件按正常 `record` 处理并广播给所有标签页，然后改为直接订阅新 host。

### `ChatHost` / runtime

基本不动。`createChatHost` 已经按 `flags.cwd` 构造一切；切换就是换一个实例。

## HTTP 接口

新增：

| 接口 | 说明 |
| --- | --- |
| `GET /api/workspaces` | `[{ path, name, active, missing?, error?, sessions: SessionRow[] }]`；`name` = 路径最后一段 |
| `POST /api/workspaces/add { path }` | 必须是已存在的目录（否则 400）；只加入列表，不切换 |
| `POST /api/workspaces/remove { path }` | 当前文件夹 → 409 |
| `GET /api/fs?path=` | `{ path, parent, dirs: string[] }`；只列子文件夹名，跳过 `.` 开头；不传 `path` 从 home 开始；不存在 / 不是目录 → 400 |
| `POST /api/fs/mkdir { path, name }` | 在 `path` 下新建 `name`；`name` 不能含 `/`、`\`、不能是 `.` / `..`、不能已存在（400） |

已有接口加可选 `cwd`（不传 = 当前文件夹，行为不变）：

| 接口 | 新行为 |
| --- | --- |
| `POST /api/reset { cwd? }` | 先 `activate(cwd)`，再新建 session；若刚切过去且打开的 session 还是空的，直接用它，不再多建一个 |
| `POST /api/resume { ref, cwd? }` | 先 `activate(cwd)`，再 resume |
| `POST /api/fork { turns?, cwd?, id? }` | 带 `id` 时先切到该文件夹并 resume 它，再 fork |
| `POST /api/rename { id, title, cwd? }` | 非当前文件夹直接写文件 |
| `POST /api/session-flag { id, flag, on, cwd? }` | 同上 |

- 所有会切文件夹的接口：跑着 → 409（`hub.assertIdle`）；目标文件夹不在列表里 → 400。
- `GET /api/sessions` 保留（只返回当前文件夹），兼容旧前端与测试。
- `--no-persist`：会话不落盘，`/api/workspaces` 与切换相关接口返回 409，侧边栏照旧显示「不保存」提示；文件夹列表本身仍可增删。

### 安全

与现状相同：只监听 `127.0.0.1`，token cookie + 同源校验。目录浏览器让网页能列出 home 乃至更上层的**文件夹名**（不含文件、不读内容）——对本机工作台可接受，在 [serve](./serve.md) 文档的安全一节注明。

## 网页

### 侧边栏

1. 顶部：「New session」（当前文件夹）、「Fork」、新增「Add folder」（打开目录浏览器）。
2. **Pinned**：所有文件夹的置顶 session；每行在时间前用浅色显示所属文件夹名。
3. **文件夹分组**（按列表顺序）：
   - 组头：折叠箭头 + 文件夹名（悬停显示完整路径）；当前文件夹组头高亮。
   - 悬停组头：`+` 在该文件夹新建 session（会切过去）；`×` 移除（当前文件夹不显示）。
   - 折叠状态存 `localStorage`。
   - 文件夹已不存在：组头变灰，显示「folder not found」，只有 `×`。
   - 组内：该文件夹未置顶、未归档的 sessions；行的交互和现在一样（相对时间、悬停图标、右键菜单、双击改名）。
4. 跑着的时候：切文件夹、`+`、点别的文件夹的 session 都禁用（和现在切 session 一样）。

### 目录浏览器（弹窗）

- 顶部当前路径，每一段可点击跳回。
- 列表：第一项 `..`（上一级），其后是子文件夹；点进入。
- 「New folder」：行内输入框，回车创建并进入。
- 「Open this folder」：加入列表 → 切过去 → 在里面新建 session。
- Escape / 点遮罩关闭；错误在弹窗底部红字显示。

### 其它

- 状态栏显示当前文件夹路径（来自 `/api/workspaces` 里 `active` 那一项）。
- 前端拉列表改用 `/api/workspaces`；刷新时机与现在拉 `/api/sessions` 相同。

## 测试

`packages/cli/test`：

- `workspaces.json`：增、删、去重、启动目录自动加入、损坏文件当空（临时 home）。
- 目录接口：只返回文件夹（不含文件、不含隐藏目录）；mkdir 非法名 400；不存在路径 400。
- 切换端到端（`--mock`）：A 发消息 → 加入 B 并新建 session → `/api/workspaces` 各组 sessions 正确 → resume A 的 session 切回 A → B 放坏的 `tah.config.json` 时切换 400 且 A 仍是当前。
- hub：`swap` 之后新开标签页只回放新文件夹的状态。
- 手动：浏览器里走一遍加文件夹、新建文件夹、切换、折叠、移除。

## 文档

- 本文；`docs/design/serve.md` 非目标与安全一节、`docs/guide/cli.md` 的 serve 说明更新；CHANGELOG Unreleased。
