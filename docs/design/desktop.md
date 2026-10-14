# 设计说明：macOS 客户端

状态：📐 已设计

`tah serve` 要先装 Node、在终端里启动，再打开浏览器。本设计把它包成一个 macOS App：双击打开，选个文件夹就能用。思路和 DeepSeek Harness 的桌面端一样——客户端只是网页工作台的壳，Agent 仍跑在本机的 Node 进程里。

## 目标

- 第一版给自己用：Apple Silicon、本地打包成 `.app` / `.dmg`，不签名、不公证。
- 不用在终端里启动；电脑上不需要装 Node。
- Agent 跑命令能找到用户 shell 里配的 PATH（Homebrew 的 `git`、`node`、`pnpm` 等）。
- 打开时回到上次用的文件夹。
- 和命令行 tah 共用 `~/.tah`：模型、key、文件夹列表、skills 是同一份；会话本来就存在各文件夹的 `.tah/` 里。

## 非目标

- 签名、公证、自动更新、Intel 版、Windows / Linux 版。
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
| `state.ts` | 读写 `~/.tah/desktop.json`（上次的文件夹） |
| `main.ts` | 把上面几块串起来：启动流程、窗口、菜单、退出 |

前三个不依赖 Electron，可以用 `node --test` 单测。

## 启动流程

1. 单实例：已经开着就把窗口拉到前面，自己退出。
2. 读登录 shell 环境：用 `os.userInfo().shell`（不是 `$SHELL`，从 Dock 打开时没有它）跑 `-ilc`，在两个分隔标记之间打印 `env -0`，解析后作为子进程的环境。超时 15 秒（`.zshrc` 里有 nvm 等时可能要 10 秒以上）；失败就用 App 自己的环境，并在日志里记一行。
3. 定文件夹：`~/.tah/desktop.json` 里的 `lastFolder` 还存在就用它；否则弹系统「选文件夹」对话框（可新建文件夹），取消就退出 App。
4. 启动子进程，等输出里出现 `[tah] open <url>`，超时 30 秒。失败（超时或子进程退出）弹错误框，显示 stderr 最后 20 行，按钮「重试」/「退出」。
5. 打开窗口，加载这个地址。

## 运行中

- 外部链接（`target=_blank` 或非本机地址）用系统默认浏览器打开，窗口里不跳走。
- 关窗口只是隐藏：正在跑的一轮继续；点 Dock 图标再显示。
- 菜单用 Electron 的标准菜单（App / Edit / View / Window），保证复制粘贴等快捷键可用。
- 子进程意外退出：弹错误框（stderr 最后 20 行），「重启服务」/「退出」。
- 「选文件夹」「新建文件夹」沿用网页里现有的功能（tah 用 `osascript` 弹系统对话框），客户端不另做。

## 退出

⌘Q 时：

1. 调 `GET /api/workspaces`，把 `active: true` 的那个写进 `~/.tah/desktop.json`。调不通就保留原值。
2. 给子进程发 `SIGINT`，tah 按原流程停止当前一轮、保存会话；5 秒内没退出就 `SIGKILL`。
3. App 退出。

## 打包

- 位置：`apps/desktop`（私有包，不发 npm）；`pnpm-workspace.yaml` 加 `apps/*`。
- Node：构建时下载固定版本的官方 Node 22 LTS（`darwin-arm64`），按官方 `SHASUMS256.txt` 校验，只取 `bin/node`，放进 `Resources/node/bin/`。解压后约 110MB，`.dmg` 压缩后约多 40MB。版本号写在 `apps/desktop` 的配置里。
- tah：先 `pnpm -r build`，再用 `pnpm deploy --prod` 把 `@typescript-agent-harness/cli` 连同依赖装成普通目录（不用 pnpm 的软链接），放进 `Resources/tah/`。
- Electron 用实施时的稳定版，锁定版本号；它只当窗口用，内置的 Node 不跑 tah。
- 用 electron-builder 出 `apps/desktop/release/tah-<版本>-arm64.dmg`；只做本机运行需要的临时签名（ad-hoc）。版本号跟仓库一致。
- 命令：`pnpm --filter desktop dist`。不进 CI、不进发版流程。

## 测试

- 单测（`node --test`）：
  - `shell-env`：解析 `env -0` 输出（分隔标记、空值、多行值）；超时回退。
  - `server`：用一个假的 `cli.js` 脚本验证读地址、超时、子进程提前退出、`SIGINT` 停止。
  - `state`：读写 `desktop.json`、文件不存在、文件夹已删除。
- 手动验收（打好的 `.dmg`）：
  1. 第一次打开弹「选文件夹」，选完进入工作台。
  2. 发一条消息；让 Agent 跑 `git --version`、`which node`，能找到。
  3. 关窗口，等一轮跑完，点 Dock 图标，内容还在。
  4. 在侧栏换一个文件夹，⌘Q，再打开，回到换过去的那个文件夹。
  5. 内置浏览器能打开 Chrome。
  6. 终端里 `tah serve` 打开同一个文件夹，能看到客户端里的会话。
  7. 活动监视器里退出后没有残留的 `node` 进程。

## 风险

| 风险 | 应对 |
| --- | --- |
| `pnpm deploy` 和 workspace 依赖配合问题（pnpm 10 需要 `inject-workspace-packages` 或 `--legacy`） | 实施第一步先手动跑通，再写进脚本 |
| 登录 shell 启动慢或会等输入（oh-my-zsh 更新提示、tmux 自启） | 设 `DISABLE_AUTO_UPDATE=true`、`ZSH_TMUX_AUTOSTART=false`，15 秒超时回退 |
| 不签名的 App 首次打开被拦 | 自己用：右键「打开」一次即可 |
