# 桌面端欢迎页设计

状态：已确认，实施中（2026-10-16）

## 目标

冷启动先进入 Cursor 风格的欢迎页：打开已有文件夹、新建项目文件夹、从列表点选；选好后再启动 `tah serve`。不再一上来弹系统选文件夹对话框。

## 约束

- 只改 `apps/desktop`；`packages/*` 不含 Electron。
- 项目列表读 `~/.tah/workspaces.json`（与网页侧栏同一份）；「上次」来自 `~/.tah/desktop.json` 的 `lastFolder`。
- 欢迎页是本地 HTML + preload IPC，不进网页工作台。

## 行为

1. 冷启动：加载 shell 环境后显示欢迎页（始终，不自动进上次项目）。
2. 「打开文件夹」：系统 `openDirectory`（可 createDirectory）。
3. 「新建项目」：同样系统选目录对话框（标题不同；可在对话框里新建空文件夹）。
4. 点列表项：存在则打开；已删除则提示，不启动。
5. 打开成功后写 `lastFolder`，窗口加载 serve URL（与现在相同）。
6. 菜单「Welcome」/「回到欢迎页」：停掉当前 serve，回到欢迎页（单实例换项目）。
7. 快捷键：⌘O 打开，⌘N 新建（菜单 accelerator）。

## 非目标

clone、多窗口、模板、改 `packages/web`。
