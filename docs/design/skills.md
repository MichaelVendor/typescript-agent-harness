# 设计说明：Skills（Agent Skills）

状态：✅ 已实现（当前开发分支；计划随 **`v0.29`** 发布，npm 上仍为 `0.28.x`）

对齐 [Agent Skills](https://agentskills.io/specification) / Claude Code / [DeepSeek Harness skills](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)：渐进披露的 Markdown 指令包，不是可执行插件。

## 背景

约定式项目已有 `AGENTS.md`（人设）、`tools/`（自定义工具）、`plugins/`（插件）、`tah.config.json`（官方能力）。缺的是「可复用任务流程」：评审、发版、查库等步骤说明若全塞进 `AGENTS.md` 会膨胀；Cursor / Claude / DSH 用 `SKILL.md` 解决——目录里只常驻 name + description，正文按需加载。

tah 作为本机 coding harness，应能直接消费现成技能目录，并提供与 DSH 同构的双入口（模型工具 + 用户 `/name`）。

## 目标

- 发现并校验本地 `SKILL.md`（及扁平 `.md`），合并项目层与用户层。
- 会话内注入 **catalog**（仅 name + description）；正文经 **`skill` 工具** 或用户 **`/name`** 按需加载。
- 加载结果带 `resourceBase` 与正文内显式相对引用的资源列表；**不**自动执行脚本。
- `tah chat` / `tah serve` 热更新技能目录（与 `AGENTS.md` / `tools/` 同类）。
- 实现落在 `packages/cli`（不新建独立 skills 包）。

## 非目标（v1）

- `tah skill add` / 技能市场 / npm 包装技能包
- `tah.config.json` 的 `capabilities.skills` 开关
- 自动执行 `scripts/`
- 远程 skill provider、DSH 式多层 scope registry
- 把 skill 正文常驻进 system prompt
- 递归扫描子目录
- 独立 `@typescript-agent-harness/skills` 包（需要多宿主复用时再抽）

## 启用条件

| 来源 | 何时扫描 |
| --- | --- |
| 项目目录（见下表前三行） | 仅当 `package.json` 依赖 `@typescript-agent-harness/cli`（与 `tools/` 同安全边界） |
| `~/.tah/skills/` | 目录存在即参与合并；非项目 cwd 也可只用用户级 |

无任何可用 skill 时：不挂 `skill` 工具、不注入 catalog。

## 发现路径

只扫一层，不递归 `**/SKILL.md`。

| 优先级（高→低） | 路径 | 形态 |
| --- | --- | --- |
| 1 | `<cwd>/skills/<name>/SKILL.md` | 目录包 |
| 2 | `<cwd>/.agents/skills/<name>/SKILL.md` | 目录包 |
| 3 | `<cwd>/.cursor/skills/<name>/SKILL.md` | 目录包 |
| 4 | `~/.tah/skills/<name>/SKILL.md` | 目录包 |

各 skills 根下另接受扁平 `<name>.md`（对齐 DSH）。同名时高优先级覆盖低优先级，不合并正文。

## `SKILL.md` 格式

遵循 agentskills.io frontmatter：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`），与目录名（或扁平文件名去 `.md`）一致，≤64 |
| `description` | 是 | 非空，≤1024；应含做什么 + 何时用 |
| `disable-model-invocation` | 否 | 默认 `false`；`true` 时不进 catalog、不可被 `skill` 工具加载 |
| `user-invocable` | 否 | 默认 `true`；`false` 时不可用 `/name` |
| `license` / `compatibility` / `metadata` / `allowed-tools` | 否 | 可解析则保留；未知键忽略（不 fail） |

坏文件（缺字段、非法 name、目录名不一致、无法解析）：**跳过** + 启动/`reload` 一行警告，不 fail boot。

## 运行时行为

### Catalog

- 存在至少一个 **model-invocable** skill 时，把排序后的 `name` + 规范化 `description`（描述截断默认 500 字符）写入 **system prompt 的 Skills 段**（与现有 MCP 提示同类），不写进用户可见 transcript。
- 不含正文、磁盘路径、来源层。
- 热更新 / reload 后按新快照重写该段；若已无 model-invocable skill，去掉该段并提示勿使用旧名（随新 system prompt 生效即可，不追加伪造用户消息）。

### 工具 `skill`

- 名称：`skill`；参数：`{ name: string }`（kebab-case）。
- 校验存在且 model-invocable；失败返回明确 tool 错误，不崩 loop。
- 每次调用重新读盘（不缓存正文）。
- 成功结果为文本，结构对齐 DSH：

```text
<skill_content name="...">
  <skill_resources>...</skill_resources>
  <skill_instructions>
  ... SKILL.md body ...
  </skill_instructions>
</skill_content>
```

- Catalog 文案提示：已加载则按 instructions 执行，勿无故重复加载同名（用户再次要求除外）。

### 用户 `/name`

- 在**直接用户输入**中匹配空白界定的 `/kebab-name`（`tah chat` 与 `tah serve`）。
- 命中且 `user-invocable !== false`：Host 在发往模型的本轮内容中附加与工具成功时同形的全文（紧挨用户文本之后）；UI transcript 仍只显示用户原话，不伪造一条「用户消息」。
- 这是 `disable-model-invocation: true` 技能的**唯一**入口。
- 未知名：当作普通文本，不报错打断。
- 同一消息多个 `/name`：按出现顺序依次附加。

### 资源

- `resourceBase` = skill 目录绝对路径（扁平 `.md` 为其父目录）。
- 从正文解析显式相对引用（如 `scripts/foo.sh`、`reference.md`、`./assets/x`）；落在 skill 根内的列入 `<skill_resources>`（路径 + 可选短说明）。
- **不**枚举整个目录；**不**自动执行脚本。
- `..` 逃出 skill 根：忽略并可选 warn。
- 模型用现有 `read_file` / `execute_command` 自行读跑。

## 与现有约定的关系

| 机制 | 职责 |
| --- | --- |
| `AGENTS.md` | 人设 / 常驻规则 |
| `tools/` / `plugins/` | 可执行扩展（代码） |
| `tah.config.json` | 官方能力包 / MCP |
| **skills** | 可选任务流程（Markdown 指令） |

`skill` 工具由 CLI 注册，不占用用户 `tools/` 文件名空间。

## 架构

```text
loadProject / home skills
        │
        ▼
 discover → parse frontmatter → merge by priority
        │
        ├─► catalog message (name + description)
        ├─► Tool: skill({ name })  → load body + resources
        └─► Host: /name in user text → inject same payload
```

实现目录：`packages/cli/src/skills/`（`discover` / `parse` / `catalog` / `tool` / `slash` / `resources`），由 `runtime` / `host` / `watch` 接线。

## 热更新

`tah chat` / `tah serve` 监听：`skills/`、`.agents/skills/`、`.cursor/skills/`、以及 `~/.tah/skills/`（若存在）。变更走现有 reload 路径（重建 Runtime、保留会话与「总是允许」审批）。

## 测试

- 四层同名优先级
- frontmatter 与 `disable-model-invocation` / `user-invocable`
- catalog 仅摘要；`skill` 返回正文 + resources
- `/name` 与双入口策略（disable-model 只能 slash）
- 资源引用与 `..` 拒绝
- 非项目 cwd 不读项目三处 skills 目录

## 文档与版本

- 交叉说明：`docs/guide/cli.md`、`docs/design/project-convention.md`、`docs/guide/status.md`、`docs/guide/roadmap.md`（Phase 14）
- `tah init` 写入轻量示例 `skills/hello/SKILL.md`（已存在则跳过）
- 计划版本线 **`v0.29`**（尚未打 tag / 升 package 版本）

## 决策摘要

| 项 | 选择 |
| --- | --- |
| 加载模型 | 渐进披露（对齐 Claude / DSH） |
| 入口 | `skill` 工具 + `/name` |
| 路径 | 项目 `skills/` + 只读兼容 `.agents` / `.cursor` + `~/.tah/skills` |
| 资源 | 按需列出引用，不自动执行 |
| 落点 | `packages/cli` 内聚 |
| 安装 | 无市场命令；拷贝/软链目录即可 |
