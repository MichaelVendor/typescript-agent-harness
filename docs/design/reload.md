# 设计说明：约定式项目热更新（v0.26）

状态：✅ 已实现（`v0.26`）

## 背景

约定式项目（见 [约定式项目设计](./project-convention.md)）的 `AGENTS.md`、`tools/`、`plugins/` 只在 `tah chat` / `tah serve` 启动时加载一次。边写工具边试的时候，每改一次都要 Ctrl+C 重启，`tah serve` 还要重新打开带令牌的链接。v0.26 让这些文件改了就生效，会话不中断。

参考了 DeepSeek Harness（`dsh`）：

- 插件代码：`cordis-plugin-hmr` 按模块依赖图找出受影响的插件，清模块缓存、释放旧插件、挂上新插件，加载失败回滚。能精确到单个插件，靠的是 cordis 的作用域——插件注册的东西都挂在作用域上，释放时自动撤销。`dsh web` 默认不监听代码目录（`root: []`），只热更新 `cordis.patch.yml`。
- `AGENTS.md`：不监听，每一步请求前重读，有变化就把差异作为一条用户消息放进下一步，不改 system prompt。

tah 的 `core` 没有作用域：插件必须在 `start()` 前注册，注册的工具撤销不了。照搬单插件替换要给 `core` 加整套机制。本设计改为**整体重建 Runtime**——相当于以 Runtime 为粒度做「释放再挂上」，只改 CLI 层；借鉴 dsh 的「加载失败保留旧版本」。

遵循的原则（见 [设计哲学](../guide/philosophy.md)）：界面和开发体验属于 Application 层，`core` / `agent` / `tools` 不为热更新加接口；不做用不到的东西。

实现中顺带修了 `core` 的一个缺陷：`Runtime.start()` 中途有插件 `setup` 抛错时，之前已 `setup` 的插件不会 `dispose`（数据库连接、MCP 子进程泄漏）。以前启动失败进程就退出，看不出来；重载失败后进程继续运行，就会每次泄漏一份。现在失败时按相反顺序 `dispose` 已启动的插件并清空服务。这是修 bug，不是新接口。

## 目标

- 终端 TUI 的 `tah chat` 和 `tah serve` 在约定式项目里监听项目文件，改了自动重载，会话和历史保留。
- 新文件有错时继续用旧版本，只提示错误。

## 非目标

- 不做单个插件 / 单个工具粒度的替换，不改 `core`。
- 不学 dsh 把 `AGENTS.md` 变化作为消息注入：重载时直接换 system prompt，代价是改一次后下一次请求的提示词缓存失效一次。
- 不监听 `--system-file`、`package.json`、`.env`，以及上面四处以外的目录，改了要重启。
- `tah run`、管道 / `--plain` 逐行模式不加热更新。

## 行为

- **范围**：`ChatHost`（TUI 与 `tah serve` 共用）。只在约定式项目（`package.json` 依赖 CLI）里生效，默认开启，`--no-watch` 关闭。
- **监听**：`AGENTS.md`；`tools/`、`plugins/`、`lib/` 下的所有文件，含子目录。`lib/` 是约定的共用代码目录（`examples/convention-agent` 的工具 `import "../lib/orders.ts"`），本身不加载，改了同样重载。目录启动时不存在，之后新建的也能发现。
- **时机**：变化防抖 200ms。正在跑一轮（含等待审批）时只记下，这一轮结束后再重载。重载中又有变化，跑完再重载一次。
- **成功**：换上新 Runtime，按 id 重新打开当前会话（`Session` 恢复时会换成当前 system prompt，所以新的 `AGENTS.md` 从下一轮生效）。提示 `[tah] reloaded: AGENTS.md tools+2 plugins+1`（格式同启动时的 project 行）。
- **失败**：继续用旧版本，提示 `[tah] reload failed — still using the previous version: <原因>`；下次保存再试。
- **「总是允许」**：`ChatHost` 自己记住答过「总是允许」的工具，重建后照样跳过审批（审批插件的记录随 Runtime 丢失）。
- **`--no-persist`**：会话只在 Runtime 内存里，重建会丢，所以不重载，只提示 `[tah] <文件> changed — restart to apply (persist is off)`。
- 不加新的 `HostEvent`，提示都用现有的 `notice`。`notice` 加可选的 `error: true`，失败提示带上它，网页显示为红色、TUI 按错误样式显示。

## 重载流程

在 `host.ts` 里，同一时间只跑一个：

1. **加载项目文件**（`loadProject`）。语法错误、导出格式不对、工具重名都在这一步报出；出错即停，旧 Runtime 不受影响。
2. **停掉旧 Runtime**（`runtime.stop()`，插件 `dispose` 照常执行）。先停旧的再起新的，避免两套同时存在（例如插件占用端口）。
3. **用新项目启动**：`bootRuntime(flags, { project })`，`attach(runtime)` 订阅事件，按 id 打开当前会话。这一步失败（插件 `setup` 抛错、工具与内置工具重名）时，用上一次的项目对象再启动一次回到旧版本——旧模块已在内存里——并提示失败。

重载进行中用户发消息、继续、切换会话：等重载完成再执行，不报「正在忙」。

## 改动

| 文件 | 改动 |
| --- | --- |
| `packages/cli/src/project.ts` | jiti 关掉模块缓存（`moduleCache: false`），每次加载读到磁盘最新内容，含辅助文件 |
| `packages/cli/src/watch.ts`（新） | `watchProject(cwd, onChange)`：非递归监听项目根目录（`AGENTS.md`，`tools/` / `plugins/` / `lib/` 的增删），递归监听这三个目录；目录新建后补上监听。不递归监听整个项目，避免扫到 `node_modules`。返回关闭函数 |
| `packages/core/src/runtime.ts` | `start()` 失败时 `dispose` 已启动的插件（见背景） |
| `packages/cli/src/runtime.ts` | `bootRuntime` 新增可选 `project`，传入已加载的项目 |
| `packages/cli/src/host.ts` | 事件订阅抽成 `attach(runtime)`；重载流程；「总是允许」记录；`close()` 关掉监听；`notice` 加可选 `error` |
| `packages/cli/src/tui/transcript.ts`、`packages/web/src/state.ts` | 带 `error` 的 `notice` 按错误样式显示 |
| `packages/cli/src/args.ts` | `watch`（默认 `true`）、`--no-watch`、用法说明 |
| `docs/guide/cli.md`、`roadmap.md`、`CHANGELOG.md` | 用法说明 |

## 错误处理

| 情况 | 表现 |
| --- | --- |
| 项目文件加载失败 | 保持旧版本，提示失败原因 |
| 新 Runtime 启动失败 | 回到旧版本，提示失败原因 |
| 一轮进行中改了文件 | 这一轮结束后再重载 |
| 重载中用户发消息 | 等重载完成再发 |
| 快速连续保存 | 防抖 200ms；重载中又有变化，结束后再来一次 |
| `--no-persist` | 不重载，提示需要重启 |
| `--no-watch` / 不是项目目录 | 不监听 |
| 删掉 `AGENTS.md` / 某个工具 | 算作变化；重载后恢复默认角色 / 去掉该工具 |

## 测试

- `packages/cli/test/watch.test.ts`：改 `AGENTS.md`、`tools/` 里的文件、子目录里的辅助文件、`lib/` 都触发；`tools/` 启动后才新建也触发；改 `node_modules`、`.tah` 不触发。
- `packages/cli/test/host.test.ts`（`--mock`，临时项目，真实 `ChatHost`）：
  - 改工具文件后，下一轮工具结果是新代码的返回值；
  - 改 `AGENTS.md` 后，会话的 system 消息是新内容，会话 id 和历史不变；
  - 工具有语法错误：提示失败，旧工具仍可用；改对后再次成功；
  - 一轮进行中改文件：这一轮结束后才重载；
  - 「总是允许」在重载后仍有效；
  - `--no-persist` 只提示；`--no-watch` 无反应。
- 手工：TUI 和网页里各自边改工具边对话。

## 已定决策

| 问题 | 决定 |
| --- | --- |
| 实现方式 | 整体重建 Runtime，不改 `core`（对比：单插件替换要给 `core` 加作用域；进程级重启会让 TUI 重画、网页重新登录） |
| 失败处理 | 保留旧版本，借鉴 dsh |
| `AGENTS.md` | 重建时换 system prompt，不做 dsh 的差异注入 |
| 范围 | `ChatHost`（TUI + `tah serve`），默认开，`--no-watch` 关 |
| 监听目录 | `AGENTS.md`、`tools/`、`plugins/`、`lib/`（实现时补上 `lib/`，因为官方示例的共用代码在那里） |
| `--no-persist` | 只提示重启 |
| 分支 | 从 `main`（v0.25.0）开 `v0.26` |
