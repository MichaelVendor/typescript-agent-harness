# Shell 沙箱设计

状态：📐 待实现

## 背景

`execute_command` 在项目根目录直接 `spawn` 程序，不是 shell。写文件和执行命令前会询问，`permissions.deny` 可以关掉这个工具。进程本身与用户的其他文件在同一个账号里。

本设计给这个子进程加一层操作系统文件系统沙箱。macOS 用 `sandbox-exec`，Linux 用 `bwrap`。命令仍在本机、以当前用户运行，这样项目里的 `node`、`npm`、`git` 还能用。

## 目标

- 沙箱只包 `execute_command` 拉起的进程及其子进程。
- 项目目录可读写。家目录的其余部分不可读、不可写。
- 系统目录可读、可执行。系统临时目录可读写。网络保持可用。
- 装在家目录里的运行时（nvm、fnm、volta、asdf）只放开这一次程序的安装目录。
- macOS 与 Linux 上，工具开着时沙箱默认开。可用配置或命令行关掉。
- 助手缺失时这次调用失败，不退回无沙箱执行。
- 审批保持原样。`--yes` 只跳过询问。

## 非目标

- 不改 `read_file`、`write_file`、`edit_file`、`grep`、`list_files` 的检查方式。
- 不清理子进程环境变量。`DEEPSEEK_API_KEY` 等仍从父进程继承。
- 不禁止网络，不做 Docker，不做 Windows 沙箱。
- 不改控制面启动参数。控制面已用 `--no-exec` 与 `--deny execute_command`，工具不挂载，因此不会起沙箱。
- 不做插件市场。

## 可见范围

工作目录是项目根（现有 `cwd`）。相对程序路径仍须留在项目内；`PATH` 上的程序名按现有规则解析。解析后的真实路径再套下面的规则。

| 路径 | 权限 |
| --- | --- |
| 项目根及其下全部路径 | 读、写、执行 |
| `/usr`、`/bin`、`/opt`、`/opt/homebrew`、`/usr/local`、`/nix`、`/System`、`/Library` 中实际存在的目录 | 读、执行 |
| `os.tmpdir()` 的真实路径；macOS 上再加 `/tmp` 与 `/private/tmp` | 读、写、执行 |
| `/dev` 中启动进程所需的设备节点（至少 `null`） | 读、写 |
| 家目录 | 默认拒绝读和写 |
| 本次安装目录（定义见下） | 读、执行 |

安装目录只在「解析后的真实路径位于家目录内、且不在项目内」时出现：

- 可执行文件所在目录名为 `bin`，且其父目录不是家目录：安装目录是这个 `bin` 的父目录。`~/.nvm/versions/node/v22/bin/node` 的安装目录是 `~/.nvm/versions/node/v22`。
- 其余情况：安装目录是可执行文件所在目录。`~/bin/tool` 的安装目录是 `~/bin`。父目录是家目录时，不放开家目录本身。

家目录下的其他 `PATH` 项不放开。子进程只能执行落在上述允许路径里的程序。

沙箱配置可以追加「不打开家目录就无法加载系统动态库」的允许规则。这类规则不得把家目录或其子目录放进去，安装目录除外。

网络允许。不使用禁止网络的 seatbelt 规则，也不给 `bwrap` 加断网参数。

## 开关

`execute_command` 未挂载时（`--no-exec`，或 `capabilities.coding` 为 `false`，或 `{ "exec": false }`），沙箱不起作用，启动行不报沙箱错误。

挂载时：

| 平台 | 默认 |
| --- | --- |
| darwin、linux | 开 |
| win32 及其他 | 关 |

`tah.config.json` 的 `capabilities.coding` 在现有 `exec` 旁增加 `sandbox` 布尔值。`coding: true` 不写 `sandbox` 时用平台默认。对象形式：

```json
{ "capabilities": { "coding": { "exec": true, "sandbox": false } } }
```

未知的 coding 键仍按现有规则报配置错误。

命令行 `--sandbox` 强制开，`--no-sandbox` 关掉。两者都出现时，后面的那个生效。命令行盖过配置，与 `--exec` / `--no-exec` 盖过 `coding.exec` 相同。

结果为开、且平台是 win32：进程在开始服务或对话前退出，错误文本为 `shell sandbox is unavailable on windows`。

结果为开、且本机没有助手：进程仍能启动。启动行打印 `sandbox=unavailable`。每次 `execute_command` 抛错，文本为 `shell sandbox unavailable: sandbox-exec`（darwin）或 `shell sandbox unavailable: bwrap`（linux）。

结果为关：启动行 `sandbox=off`，`spawn` 与现在相同。

结果为开且助手存在：启动行 `sandbox=on`。子进程是 `sandbox-exec` 或 `bwrap`，再执行原来的程序和参数。

审批仍在 `spawn` 之前。`--yes` 跳过审批，沙箱照常套上。

## 失败

| 情况 | 调用方看到的 |
| --- | --- |
| 助手不在 `PATH` | 抛错 `shell sandbox unavailable: sandbox-exec` 或 `shell sandbox unavailable: bwrap` |
| 助手在程序启动前退出，或配置被助手拒绝 | 抛错 `shell sandbox failed: ` 接助手 stderr 的第一行非空文本；stderr 为空时用助手的退出码，形如 `shell sandbox failed: exit 1` |
| 程序已在沙箱内运行，再访问项目外或家目录 | 工具正常返回现有的 `exitCode`、`stdout`、`stderr`、`truncated`、`timedOut`。拒绝表现为程序自己的非 0 退出或权限错误 |

程序是否已经在沙箱内启动，看临时目录里的 ready 文件。助手执行的第一段是 `/bin/sh -c`，它先 `touch` 这个文件，再 `exec` 用户的程序和参数。进程结束后文件存在：按上一行的程序结果返回，即使退出码非 0 且 stderr 为空。文件不存在：才是助手失败，使用 `shell sandbox failed`。

不在失败后重试一次无沙箱执行。

## 测试

单元测试每次 CI 都跑，不依赖本机是否安装助手：

- 拼出的参数里，项目目录可写，家目录默认不在允许写入的范围，安装目录按上一节的两条例子放开，参数里没有断网开关。
- 助手查找函数注入为找不到时，抛出 `shell sandbox unavailable: …`。
- 沙箱关闭时，spawn 的程序就是用户给出的程序，参数里没有 `sandbox-exec` 或 `bwrap`。
- 配置：`sandbox: false` 被解析；未知 coding 键仍失败；`--no-sandbox` 盖过配置里的 `true`；`--sandbox` 盖过 `false`。
- win32 且结果为开时，启动路径抛出 `shell sandbox is unavailable on windows`。这个用例把平台作为参数传入，不要求在 Windows 上跑。

真隔离：沙箱内读取项目外的临时文件必须失败，读取项目内文件必须成功。助手不在 `PATH` 时跳过。GitHub CI 的测试任务是 `ubuntu-latest`，不假设装了 `bwrap`，因此这条在 CI 上可以跳过。本机有 `sandbox-exec` 时会执行。

## 改动位置

- `packages/tools`：`execute_command` 在沙箱开启时经助手启动。策略与参数组装放在该包，便于不启动 CLI 就测试。
- `packages/cli`：解析 `coding.sandbox`、`--sandbox` / `--no-sandbox`，启动前做 Windows 检查，启动行打印 `sandbox=`。
- 文档：`docs/guide/tools.md`、`docs/guide/cli.md`、`docs/design/config.md`、`docs/guide/status.md`。`status.md` 的未做列表去掉 shell/sandbox。

## 文档

实现时按本文更新上述文件。`execute_command` 的说明从「无 sandbox」改为：默认在 macOS / Linux 上经 `sandbox-exec` / `bwrap` 限制文件系统，网络仍可用，环境变量仍继承。
