# 设计说明：macOS 客户端

状态：✅ 已实现（v0.35）

`tah serve` 要先装 Node、在终端里启动，再打开浏览器。本设计把它包成一个 macOS App：双击打开，选个文件夹就能用。思路和 DeepSeek Harness 的桌面端一样——客户端只是网页工作台的壳，Agent 仍跑在本机的 Node 进程里。

## 目标

- 第一版给自己用：Apple Silicon、本地打包成 `.app` / `.dmg`，不签名、不公证。
- 不用在终端里启动；电脑上不需要装 Node。
- Agent 跑命令能找到用户 shell 里配的 PATH（Homebrew 的 `git`、`node`、`pnpm` 等）。
- 打开时回到上次用的文件夹。
- 和命令行 tah 共用 `~/.tah`：模型、key、文件夹列表、skills 是同一份；会话本来就存在各文件夹的 `.tah/` 里。

## 非目标

- 签名、公证、Sparkle / 自动更新、Intel 版、Windows / Linux 版（打 tag 会挂未公证的 arm64 `.dmg` 到 GitHub Release，见「打包」）。
- 托盘图标、退出前「有任务在跑」的确认。
- DeepSeek 账号登录：模型照旧在 Settings 里填 key。
- 网页界面的任何改动。

## 硬约束：内核不含 Electron 代码

`packages/*`（含 `cli`）一行不改，也不出现 Electron 专用逻辑。客户端只通过两样公开的东西和 tah 打交道：

- 命令行：`tah serve --cwd <文件夹> --port 0 --no-open`
- HTTP 接口：`GET /api/workspaces`（和网页一样带登录 cookie）

不在 Electron 主进程里直接跑 tah：那样 `process.execPath` 指向 Electron，内置浏览器起 Playwright MCP 时需要 `ELECTRON_RUN_AS_NODE=1`；这个变量设在外面又会传给 Agent 执行的命令（比如用户让 Agent 跑 `npx electron .`）。

## 架构

```text
tah.app
├── Electron 主进程（apps/desktop/src/main.ts）
│   ├── 单实例锁、菜单、窗口、选文件夹对话框
│   ├── 读登录 shell 的环境变量
│   └── 子进程：<Resources>/node/bin/node <Resources>/tah/dist/cli.js serve --cwd … --port 0 --no-open
│                 └── 输出 "[tah] open http://127.0.0.1:<port>/?token=…"
└── 窗口（BrowserWindow）：打开上面的地址；网页没有 Node 权限，沙箱运行
```

| 单元 | 做什么 |
| --- | --- |
| `shell-env.ts` | 跑一次登录 shell，读出环境变量 |
| `server.ts` | 启动 / 停止 `tah serve` 子进程，读出地址，查当前文件夹 |
| `state.ts` | 读写 `~/.tah/desktop.json`；读 `workspaces.json` 生成欢迎页项目列表 |
| `welcome/` | 欢迎页 HTML + CommonJS `preload.cjs`（sandbox 下不能用 ESM；不进 `packages/web`） |
| `main.ts` | 把上面几块串起来：欢迎页、启动流程、窗口、菜单、退出 |

`state` / `shell-env` / `server` 不依赖 Electron，可以用 `node --test` 单测。

## 启动流程

1. 单实例：已经开着就把窗口拉到前面，自己退出。
2. 读登录 shell 环境：用 `os.userInfo().shell`（不是 `$SHELL`，从 Dock 打开时没有它）跑 `-ilc`，在两个分隔标记之间打印 `env -0`，解析后作为子进程的环境。超时 15 秒（`.zshrc` 里有 nvm 等时可能要 10 秒以上）；失败就用 App 自己的环境，并在日志里记一行。
3. 先打开本地欢迎页（`welcome/index.html` + preload IPC）：列出 `~/.tah/workspaces.json` 里的项目，「上次」来自 `~/.tah/desktop.json` 的 `lastFolder`；可「打开文件夹」「新建项目」（系统选目录对话框），或点列表项。冷启动不自动进上次项目。
4. 选好文件夹后再启动子进程，等输出里出现 `[tah] open <url>`，超时 30 秒。失败弹错误框（stderr 最后 20 行），「重试」/「回到欢迎页」/「退出」。
5. 成功则把窗口切到这个地址；并写回 `lastFolder`。

## 运行中

- 外部链接（`target=_blank` 或非本机地址）用系统默认浏览器打开，窗口里不跳走。
- 关窗口只是隐藏：正在跑的一轮继续；点 Dock 图标再显示。
- 菜单：标准 App / Edit / View / Window，另加 File → Welcome（⌘⇧W，停掉 serve 回到欢迎页换项目）、Open Folder…（⌘O）、New Project…（⌘N）。
- 子进程意外退出：弹错误框，「重启服务」/「回到欢迎页」/「退出」。
- 网页侧栏里换文件夹仍走 tah 原有逻辑（`osascript` 等）；客户端欢迎页只负责冷启动和整窗换项目。

## 退出

⌘Q 时：

1. 调 `GET /api/workspaces`，把 `active: true` 的那个写进 `~/.tah/desktop.json`。调不通就保留原值。
2. 给子进程发 `SIGINT`，tah 按原流程停止当前一轮、保存会话；5 秒内没退出就 `SIGKILL`。
3. App 退出。

## 打包

- 位置：`apps/desktop`（私有包，不发 npm）；`pnpm-workspace.yaml` 加 `apps/*`。
- Node：构建时下载固定版本的官方 Node 22 LTS（`darwin-arm64`），按官方 `SHASUMS256.txt` 校验，只取 `bin/node`，放进 `Resources/node/bin/`。解压后约 110MB，`.dmg` 压缩后约多 40MB。版本号写在 `apps/desktop` 的配置里。
- tah：先 `pnpm -r build`，再用 `pnpm --filter @typescript-agent-harness/cli deploy --prod --legacy --config.node-linker=hoisted` 把 cli 连同依赖装成普通目录，删掉 `node_modules/.bin`（只有软链接），放进 `Resources/tah/`。
- Electron 用实施时的稳定版，锁定版本号；它只当窗口用，内置的 Node 不跑 tah。
- 用 electron-builder 出 `apps/desktop/release/tah-<版本>-arm64.dmg`；图标是 `apps/desktop/build/icon.png`（1024，漆红底，一只圆角的白纸鹤）。只做本机运行需要的临时签名（ad-hoc）。版本号跟仓库一致。
- 命令：`pnpm --filter @typescript-agent-harness/desktop dist`（打包前会清空 `apps/desktop/release/`，不留旧版 `.dmg`）。本地可照旧打；推送 `v*.*.*` tag 时 [Publish](../../.github/workflows/publish.yml) 的 `desktop` job（`macos-14`）自动打包，并把 `.dmg` 挂到同名 GitHub Release（未公证；Release 说明里写首次右键「打开」）。与发 npm 并行，互不挡。

## 测试

- 单测（`node --test`）：
  - `shell-env`：解析 `env -0` 输出（分隔标记、空值、多行值）；超时回退。
  - `server`：用一个假的 `cli.js` 脚本验证读地址、超时、子进程提前退出、`SIGINT` 停止。
  - `state`：读写 `desktop.json`、文件不存在、文件夹已删除；`listProjects` 读 workspaces、标上次/已删除。
- 手动验收（打好的 `.dmg`）：
  1. 第一次打开是欢迎页；打开或新建文件夹后进入工作台；列表能看到该项目且标「上次」。
  2. File → Welcome 回到欢迎页，点另一个项目能换过去。
  3. 发一条消息；让 Agent 跑 `git --version`、`which node`，能找到。
  4. 关窗口，等一轮跑完，点 Dock 图标，内容还在。
  5. 在侧栏换一个文件夹，⌘Q，再打开（欢迎页）能看到「上次」是换过去的那个。
  6. 内置浏览器能打开 Chrome。
  7. 终端里 `tah serve` 打开同一个文件夹，能看到客户端里的会话。
  8. 活动监视器里退出后没有残留的 `node` 进程。

## 风险

| 风险 | 应对 |
| --- | --- |
| `pnpm deploy` 和 workspace 依赖配合问题（pnpm 10 需要 `inject-workspace-packages` 或 `--legacy`） | 实施第一步先手动跑通，再写进脚本 |
| 登录 shell 启动慢或会等输入（oh-my-zsh 更新提示、tmux 自启） | 设 `DISABLE_AUTO_UPDATE=true`、`ZSH_TMUX_AUTOSTART=false`，15 秒超时回退 |
| 不签名的 App 首次打开被拦 | 自己用：右键「打开」一次即可 |
