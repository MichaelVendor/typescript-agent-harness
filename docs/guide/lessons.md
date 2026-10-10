# 版本踩坑与改动对照

状态：✅ 按真实踩坑整理；能力清单见 [CHANGELOG](https://github.com/MichaelVendor/typescript-agent-harness/blob/main/CHANGELOG.md)，路线见 [路线图](/guide/roadmap)。

本页只记：**遇到什么问题 → 为什么要改 → 怎么改的**。方便对照版本查阅，不是完整功能年表。

---

## 怎么读

| 列 | 含义 |
| --- | --- |
| 问题 | 你或发布路径上实际踩到的现象 |
| 原因 | 根因（不是表面报错） |
| 改法 | 落到代码 / 文档 / 流程上的处理 |
| 版本 | 合入并发布的版本（未发写「开发中」） |

未解决的坑集中在文末 [仍未做](#仍未做)。

---

## 0.26 — 改了项目文件要重启；启动失败泄漏资源；网页小毛病

### 1. 改个工具或 `AGENTS.md` 就得退出重开

| | |
| --- | --- |
| **问题** | 约定式项目里调工具、改人设，每次都要 `/exit` 再 `tah chat`；网页里还得重开 `tah serve` 和标签页。 |
| **原因** | 项目文件只在启动时加载一次；jiti 默认缓存模块，就算重新加载，改过的辅助文件（`lib/`）也读到旧版本。 |
| **改法** | 终端 `tah chat` / `tah serve` 监听 `AGENTS.md`、`tools/`、`plugins/`、`lib/`；改动后重建整个 Runtime，按 id 重开当前会话（历史保留，新 `AGENTS.md` 换进 system prompt）。jiti 关掉模块缓存。一轮进行中改的等这一轮结束；加载失败继续用旧版本。`--no-watch` 关闭。 |

### 2. 插件 `setup` 抛错后，前面的插件没释放

| | |
| --- | --- |
| **问题** | 热更新时新插件 `setup` 抛错要回滚到旧版本，但已经启动的插件（MCP 子进程、SQLite 连接）还开着。 |
| **原因** | `Runtime.start` 失败时直接抛出，只有 `stop()` 才会逆序 `dispose`，而失败的 Runtime 不会再被 `stop`。 |
| **改法** | `start()` 失败时逆序 `dispose` 已 setup 的插件、清空服务、回到 `idle`，再抛出原错误。 |

### 3. 网页侧栏不刷新、失败提示看不出来、输入框和按钮没对齐

| | |
| --- | --- |
| **问题** | 很快结束的一轮（mock 模型）跑完，侧栏的轮数不变；热更新失败的提示是灰色，和普通提示一样；输入框比发送按钮高 6px。 |
| **原因** | 侧栏只在 `busy` 由真变假时刷新，而一帧内开始又结束的一轮 `busy` 从没渲染成真；`notice` 事件没有错误标记；按钮内边距和输入框不同。 |
| **改法** | 网页状态记「已结束轮数」，侧栏跟着它刷新；`notice` 加可选 `error`，失败提示网页标红、TUI 走错误样式；单行时输入框和按钮同高（0.26.1）。 |

---

## 0.25 — 两个项目同时 `tah serve` 互相顶掉登录

| | |
| --- | --- |
| **问题** | 两个目录各开一个 `tah serve`（端口不同），登录一个后另一个标签页变成未登录。 |
| **原因** | 浏览器的 cookie 不区分端口，两个服务写的是同名 cookie，后登录的覆盖先登录的。 |
| **改法** | cookie 名带上端口（`tah_token_<port>`）。 |

---

## 0.24 — TUI 流式输出崩溃、光标错位

### 1. 长回复流到一半崩溃（0.24.1）

| | |
| --- | --- |
| **问题** | 模型回复一长，TUI 报 `Maximum update depth exceeded` 退出。 |
| **原因** | 文本增量在连续的微任务里到达，每个增量同步重绘一次；Ink 的 `useBoxMetrics` 又在每次渲染后再触发一次更新，叠加起来触发 React 的嵌套更新上限。 |
| **改法** | 转录状态每个事件循环 tick 最多通知界面一次，合并重绘。 |

### 2. 输入框光标跑到状态栏下面（0.24.2）

| | |
| --- | --- |
| **问题** | 回复结束后终端光标在状态栏下方，打字时光标落后一个字符。 |
| **原因** | 光标位置在渲染之后才设置，总是用上一次渲染的布局。 |
| **改法** | 在渲染时设置光标位置。 |

---

## 0.23 — `tah init` 后跑不起来

| | |
| --- | --- |
| **问题** | `tah init` 只生成文件，用户直接 `tah chat` 报一大段 Node require 栈；在别的 pnpm 工作区里装依赖，装的是外层工作区，项目本身还是缺包。 |
| **原因** | 初始化不装依赖；加载项目文件时缺包没有翻译成人话；`pnpm install` 会向上找 `pnpm-workspace.yaml`。 |
| **改法** | 0.23.1：`tah init` 按锁文件 / 启动它的包管理器自动装依赖，在别的 pnpm 工作区里加 `--ignore-workspace`；`--no-install` 跳过。缺包时提示包名和要跑的安装命令。 |

---

## 0.22 — 默认能跑命令没人把关；长会话越聊越大；角色写死；打断与失败；只能续最近一个

### 1. 写文件 / 跑命令不经确认

| | |
| --- | --- |
| **问题** | 0.21 默认开 exec 后，模型可以不经确认就写文件、跑任意命令；只能事先 `--deny`，没有「执行前问我」。对标 DeepSeek Harness 时最大差距也在这：事件只能旁观，不能拦截。 |
| **原因** | EventBus 只有 `emit`（顺序通知），没有可改写/可短路的拦截点；权限检查硬编码在 `toolsPlugin.execute` 里（直接 import `PERMISSIONS`），新策略只能改 tools 包。 |
| **改法** | core 增加 waterfall：`ctx.intercept` / `ctx.waterfall`；所有工具调用走 `tool.execute`。`--allow/--deny` 改成 permissions 插件里的拦截器；新增 `approvalPlugin`。CLI 对 `write_file` / `execute_command` 问 `[y/n/a]`，`--yes` 跳过；非终端无 `--yes` 直接拒绝。 |

### 2. 续聊默认开启后，上下文只增不减

| | |
| --- | --- |
| **问题** | 0.21 起 `tah chat` 总是续最近 Session；聊得越久，每次请求越大，迟早超模型上限或 token 费暴涨。 |
| **原因** | Loop 每步把 `session.messages` 全量发给 LLM，没有任何预算。 |
| **改法** | `agentPlugin({ contextChars })` + 纯函数 `projectContext`：先省略旧工具输出，再整轮丢最早对话（保证 tool 调用/结果成对），当前轮保留；完整历史不删。CLI 默认 100,000 字符，裁剪时打印 `[ctx]`。 |

### 3. 想换个角色只能改源码

| | |
| --- | --- |
| **问题** | CLI 的「workspace coding agent」写死在 `prompt.ts`；而且续聊时用的是建 Session 时存下的 system，改了也不生效。 |
| **原因** | system prompt 只在 `create()` 时写入 messages，重开 Session 直接用存储里的旧值。 |
| **改法** | `--system-file <path>` 替换角色句；重开 Session 时用当前 `systemPrompt` 覆盖旧的那条。 |

### 4. 打断不了、网络一抖整个 chat 退出

| | |
| --- | --- |
| **问题** | 模型跑长命令时 Ctrl+C 停不下来（0.22 读审批回答后 `tah run` 也吞了 Ctrl+C）；接口偶发 429 / 断网，chat 直接抛错退出。 |
| **原因** | readline 原始模式接管 ^C 但没人处理；LLM 请求无重试；chat 循环不捕获单轮异常。另：一轮在「模型已发 tool_calls、工具没跑完」时中断，下一轮请求缺 tool 结果，DeepSeek 会 400。 |
| **改法** | chat：^C 取消当前轮（`session.cancel()`，审批等待也能取消），空闲时 ^C 退出；`run` 用 cooked 模式让 ^C 直接退出。openai-compatible 在响应开始前对网络错误 / 408 / 429 / 5xx 退避重试 3 次。新一轮开始前给未完成的 tool_calls 补「未执行」结果。单轮失败只打印，不退出。 |

### 5. 「同一段回复打两遍」

| | |
| --- | --- |
| **问题** | 0.8 起偶发看到回复像被打印了两次。 |
| **原因** | 复现后确认每段流式文字只打印一次：模型在调工具前说的话与 `[tool]` 日志挤在同一行，最终回答又常复述过程，看起来像重复。 |
| **改法** | 流式文字未换行时，日志先换行再打印；重试只发生在响应开始前，不会重放已打印的文字。 |

### 6. 只能续「最近一个」Session，也回不到某一轮

| | |
| --- | --- |
| **问题** | `/reset` 开了新话题后，旧 Session 还在库里但打不开；某一轮走偏了，只能整个重来。 |
| **原因** | CLI 只会 `list()[0]`；Session 服务没有复制 / 截断历史的能力。 |
| **改法** | `tah sessions` 列表；`tah chat --session <id\|n>`、chat 内 `/sessions` `/resume`；`SessionService.fork(id, { turns })` + `/fork [n]` 复制（或只留前 n 轮）到新 Session，原 Session 不动。 |

---

## 0.21 — 默认太「安全」导致不好用

| | |
| --- | --- |
| **问题** | 易触 max iteration；`/exit` 无记忆；默认无 `execute_command`；工具面偏窄。 |
| **原因** | CLI 默认 `maxSteps=8`、无 persist 续聊、exec 默认关——偏演示安全，不偏本机 coding。 |
| **改法** | 默认 `maxSteps=32`（`--max-steps`）、默认 persist（`--no-persist` 关掉）、默认 exec（`--no-exec` 关掉）；`tah chat` 自动 resume 最近 Session。 |

---

## 0.20 — 长任务失败难看 + 没 shell 空转

### 1. `state=failed` 却几乎没说明

| | |
| --- | --- |
| **问题** | 分析大项目、连读很多文件后出现 `[tah] state=failed steps=几十`，助手正文为空或像突然断掉。 |
| **原因** | DefaultLoop 的 LLM 轮次触达 `maxSteps`（当时 CLI 默认 8）时，`finishReason=max_steps`，但 `text` 是空串；状态被标成 `failed`，用户分不清是崩溃还是步数用尽。 |
| **改法** | Loop 在 `max_steps` 时写入可读说明（含 `maxSteps=N`）；CLI 状态行增加 `finishReason=max_steps`。额度默认抬高见 0.21。 |

### 2. 「帮我跑测试」却只能静态看代码

| | |
| --- | --- |
| **问题** | 用户说「测试 / 构建 / 跑一下」，模型长篇解释「我没有 shell」，不知道可以开 `--exec`。 |
| **原因** | 默认故意不挂 `execute_command`；system prompt 未说明如何开启。 |
| **改法** | 0.20：无 exec 时提示 `tah --exec`。0.21：默认打开 exec，关掉用 `--no-exec`。 |

---

## 0.19 — 管道 chat 崩 + 静默 mock

### 1. `printf` 喂多轮 chat → `readline was closed` / exit 1

| | |
| --- | --- |
| **问题** | 交互终端 `/exit` 正常；`printf 'a\nb\n' \| tah chat` 第一轮结束后崩。 |
| **原因** | 用 `readline/promises` 的 `question()`：管道里 stdin 在第一轮 LLM 期间已被读完并 close，第二轮再 `question` 触发 `ERR_USE_AFTER_CLOSE`。 |
| **改法** | 改成 `for await` 按行读；EOF 正常结束（exit 0）。管道：`printf '第一句\n第二句\n' \| tah --mock chat`。 |

### 2. 没 API key 却静默走 mock

| | |
| --- | --- |
| **问题** | 日志只有 `llm=mock`，容易以为「模型很笨」，其实根本没打真模型。 |
| **原因** | `bootRuntime`：`flags.mock \|\| !hasKey → mock`，缺 key 时静默降级。 |
| **改法** | 无 key 且无 `--mock` → 退出码 1，stderr 提示设 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 或加 `--mock`。测语义必须去掉 `--mock`，key 放在 `--cwd` 的 `.env`。 |

---

## 0.18 — 全局安装文档

| | |
| --- | --- |
| **问题** | CLI 有 bin `tah`，但文档主推 npx，用户不知道能否 `npm install -g`。 |
| **原因** | 发布与文档不同步；本机还有 `~/.npm-global` 属主是 root（曾用过 `sudo npm`）导致 `EACCES`。 |
| **改法** | 文档补全局安装步骤与 PATH；**不要 sudo npm**。权限坏了：`sudo chown -R "$(whoami)" ~/.npm-global`。npm 网页/本地 cache 可能滞后，用 `--prefer-online` 或清 cache。 |

---

## 0.17 — `--help` 冒 sqlite 实验警告

| | |
| --- | --- |
| **问题** | `tah --help` / `npx … --help` 打出 `ExperimentalWarning: SQLite`。 |
| **原因** | CLI 静态依赖链把 `storage`（含 `node:sqlite`）在启动时加载；help 路径不需要 storage。 |
| **改法** | help 只解析 argv；`--persist` 时再动态 `import` storage。SQLite 仅在挂 persist 时加载。持久化时仍会警告，0.22.7 起启动时不再打印。 |

---

## 0.16 — 安装入口混乱

| | |
| --- | --- |
| **问题** | 新人先 clone + `pnpm build` 才能试 CLI，摩擦大。 |
| **原因** | 文档仍以源码开发为主路径。 |
| **改法** | 文档主路径改为 `npx @typescript-agent-harness/cli`；clone / pnpm 标成「从源码开发」。 |

---

## 0.15 — 能发到 npm

| | |
| --- | --- |
| **问题** | 包在仓库里，外面装不到；本机默认源是 npmmirror，`npm whoami` / publish 易踩鉴权。 |
| **原因** | 缺 `publishConfig`、CI `NPM_TOKEN`、scope registry；sudo / 镜像 registry 混用。 |
| **改法** | 各包 `publishConfig.access: public`；tag `v*.*.*` 触发 Publish；token 走 GitHub Secret；本机 scope 指向 `registry.npmjs.org`，**不要 sudo**。 |

---

## 0.9 – 0.14 — 能力默认关（不是 bug，是门闩）

这些版本主要是**把已有插件接到 CLI 开关上**，默认仍关，避免「一装上就能乱跑命令」。

| 版本 | 现象（若你期望「开箱就有」会懵） | 原因 | 改法 / 用法 |
| --- | --- | --- | --- |
| 0.9 | 没有跑命令的能力 | 先做 `execute_command`（spawn，非 shell），默认不挂到 tah | API：`executeCommandTool`；CLI 见 0.10 |
| 0.10 | `tah` 仍跑不了命令 | 默认安全：须显式 `--exec` | `tah --exec …` |
| 0.11 | 搜代码靠读文件太笨；exec 超时会挂 | 缺 grep；kill 后仍等 pipe | 默认挂 `grep`；超时 destroy/kill |
| 0.12 | 接不了 MCP | 须 `--mcp` / `--mcp-arg` | `tah --mcp node --mcp-arg …` |
| 0.13 | 挡不住危险工具 | 须 `--allow` / `--deny` | `--deny write_file` 等 |
| 0.14 | 想延迟跑一轮 | 须 `--once <ms>`（仅 `run`） | `tah --once 200 run "…"` |

---

## 0.1 – 0.8 — 骨架到可流式 CLI（能力引入）

这些版本多为**按路线图落地**，不是修线上事故。查阅功能用 CHANGELOG；这里只记和「后来踩坑」相关的设计选择。

| 版本 | 做了什么 | 和后来坑的关系 |
| --- | --- | --- |
| 0.1 | Runtime / Plugin / Context / EventBus | 一切皆插件，CLI 只是一种挂载方式 |
| 0.2 | LLM + Tools + Session + Loop | mock 会套话「说明项目」——测语义不要 `--mock` |
| 0.3 | SQLite + checkpoint + `session.resume()` | **API / demo 可 resume；CLI 仍不会跨进程续聊** |
| 0.4 | permissions / MCP / scheduler / subagent | 能力在包里，CLI 默认不挂（见 0.9+） |
| 0.5 | `tah run` / `tah chat` | 默认 coding system prompt + 工作区工具 |
| 0.6 | 测试 + CI + stdio MCP | 质量地板 |
| 0.7 | 改名 typescript-agent-harness / `tah` / `.tah` | 旧名不再用 |
| 0.8 | `llm.stream` + 增量输出 | 偶发「同一段打两遍」：0.22 查明是排版 + 模型复述，见 0.22 第 5 条 |
---

## 仍未做

下面是实打实踩到、**当前版本仍未修**的点（避免当成已发布能力）：

| 问题 | 说明 |
| --- | --- |
| 流式中途断开不重试 | 已经打印了一部分时不重放，直接报错；再说一次即可 |
| 仓库根目录跑 tah 会读 `examples/basic-agent/.env` | `loadCliEnv` 故意兼容；别的项目请用该项目的 `--cwd` + `.env` |
| 无浏览器 / 无跨工作区 `cp` | 刻意不做；需要 `--exec`（现已默认开）或自己在终端操作 |
| 分叉不记父子关系 | `tah sessions` 看不出谁 fork 自谁（只在 `session.forked` 事件里） |
| 上下文裁剪不做摘要 | 丢掉的旧轮次模型就看不到了；按字符估算，不是真实 token 数 |
| 每个 LLM step 都存一份完整 request | 长会话 `.tah/cli.db` 会明显变大；裁剪后单份有上限，但份数随步数线性增长 |

---

## 实战速查（对照你的笔记）

| 你想做的事 | 正确用法 |
| --- | --- |
| 测真 DeepSeek | 项目目录 `.env` 放 key；**不要** `--mock` |
| 跑测试 / 构建 | `tah chat`（0.21 默认已有 exec；关掉用 `--no-exec`） |
| 管道多轮 | `printf 'a\nb\n' \| tah --mock chat`（0.19+） |
| 只读 | `tah --deny write_file --deny execute_command …` |
| 全局 `tah` | `npm i -g @typescript-agent-harness/cli`（权限见 0.18） |
| 长任务失败 | 看 `finishReason=max_steps`；加大 `--max-steps` 或拆任务 |
| 跨 `/exit` 续聊 | 再开 `tah chat`（默认 persist；`--no-persist` 则不会续） |
| 不想每次被问 y/n | 当次回 `a`（该工具本次不再问），或启动加 `--yes`（0.22+） |
| 管道 / 脚本里要写文件 | 必须加 `--yes`，否则审批直接拒绝（0.22+） |
| 换个角色（审查 / 写测试 …） | `tah --system-file role.md chat`（0.22+） |
| 看到 `[ctx] trimmed` | 正常，旧内容被省略；换话题就 `/reset`（0.22+） |
| 模型跑偏 / 命令太久 | chat 里 Ctrl+C 停这一轮，接着说（0.22+） |
| 回到旧话题 | `tah sessions` 看序号，`tah chat --session <n>`；chat 里 `/resume <n>`（0.22+） |
| 某一轮走偏想重来 | `/fork <n>` 只保留前 n 轮，原 Session 不动（0.22+） |
| 做自己的 Agent | `npx @typescript-agent-harness/cli init`，`AGENTS.md` + `tools/`（0.23+） |
| 在浏览器里用 | `tah serve`，打开终端打印的链接（0.25+） |
| 改了工具 / 人设 | 保存即可，`tah chat` / `tah serve` 自动重新加载（0.26+）；`tah run` 和 `--no-persist` 要重启 |

---

## 相关链接

- [CHANGELOG（完整发版说明）](https://github.com/MichaelVendor/typescript-agent-harness/blob/main/CHANGELOG.md)
- [CLI 用法](/guide/cli)
- [Agent 与 Session / resume API](/guide/agent-session)
- [路线图](/guide/roadmap)
