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

## 0.21（开发中）— 默认太「安全」导致不好用

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
| **改法** | help 只解析 argv；`--persist` 时再动态 `import` storage。SQLite 仅在挂 persist 时加载。 |

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
| 0.8 | `llm.stream` + 增量输出 | 偶发「同一段打两遍」仍可能出现，见下 |

---

## 仍未做

下面是实打实踩到、**当前版本仍未修**的点（避免当成已发布能力）：

| 问题 | 说明 |
| --- | --- |
| 流式偶发同一段回复打两遍 | stream + 非 stream 打印路径可能重叠；未专项修 |
| 仓库根目录跑 tah 会读 `examples/basic-agent/.env` | `loadCliEnv` 故意兼容；别的项目请用该项目的 `--cwd` + `.env` |
| 默认 persist 时 sqlite ExperimentalWarning | 0.17 只保证 `--help` 不加载；persist 路径仍会警告 |
| 无浏览器 / 无跨工作区 `cp` | 刻意不做；需要 `--exec`（现已默认开）或自己在终端操作 |
| 续聊只接「最近一个」Session | `/reset` 后旧 Session 仍在库里，但 reopen 总是最新一条 |

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

---

## 相关链接

- [CHANGELOG（完整发版说明）](https://github.com/MichaelVendor/typescript-agent-harness/blob/main/CHANGELOG.md)
- [CLI 用法](/guide/cli)
- [Agent 与 Session / resume API](/guide/agent-session)
- [路线图](/guide/roadmap)
