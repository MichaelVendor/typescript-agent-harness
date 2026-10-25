# 设计说明：Skills（Agent Skills）

状态：✅ 已实现（v0.29；远程安装 **v1.6.1**）

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

## 非目标

- Claude Code 完整 plugin marketplace / Discover 面板 / hooks 插件
- npm 包装技能包
- `tah.config.json` 的 `capabilities.skills` 开关
- 自动执行 `scripts/`
- DSH 式多层 scope registry
- 把 skill 正文常驻进 system prompt
- 递归扫描子目录（安装时只扫一层 + `skills/` + marketplace.json 列表）
- 独立 `@typescript-agent-harness/skills` 包（需要多宿主复用时再抽）

## 启用条件

| 来源 | 何时扫描 |
| --- | --- |
| 工作目录（见下表前三行） | 总是扫描（v0.30.1 起；之前只在 `package.json` 依赖 `@typescript-agent-harness/cli` 的项目里扫描） |
| `~/.tah/skills/` | 目录存在即参与合并 |

v0.30.1 起普通文件夹也读这三处，和 Cursor / Claude Code 读自己的 skills 目录一样；这样 Agent 用 `write_file` 写入 `skills/<name>/SKILL.md` 就算装好了。代价：打开一个别人的仓库时，里面的 skill 指令也会进 catalog。Skill 只是 Markdown 指令，不执行代码；`tools/`、`plugins/` 仍只在项目里加载。

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
- Web / TUI 输入 `/` 时的补全菜单列出内置命令、当前已加载且 `user-invocable` 的 skill，以及可 `/name` 展开的 MCP prompt（同名时：内置 > skill > prompt）。选中为**插入**到输入框，再 `Enter` 发送/执行（与 Claude Code 一致）。
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

`tah chat` / `tah serve` 监听：`skills/`、`.agents/skills/`、`.cursor/skills/`、以及 `~/.tah/skills/`（若存在）。变更走现有 reload 路径（重建 Runtime、保留会话与「总是允许」审批）。普通文件夹（非项目）只监听这几处 skills 目录，改 `lib/`、`AGENTS.md` 等不会触发 reload。

## 让模型知道 Skill（v0.30.1）

内置工具模式下，系统提示词总会附一段：Agent 运行在 tah 里（不是 Cursor / Claude Code）、Skill 的格式和存放位置、用 `write_file` 写 `skills/<name>/SKILL.md` 即可安装、网页 Settings → Skills 可导入。没有这段时，模型看到「skill.md」会照 Cursor 的方式回答。项目只用自己工具（`builtinTools: false`）时不加，角色完全由项目决定。

## 网页导入（v0.30.1）

`tah serve` 的 Settings → Skills 列出当前文件夹加载的 skill（「All folders」= `~/.tah/skills`，「This folder」= 工作目录三处）。「Import skill folder…」弹系统对话框：选中的文件夹有 `SKILL.md` 就导入它一个，否则导入其下一层所有带 `SKILL.md` 的文件夹（如 `~/.cursor/skills`）。复制到 `~/.tah/skills/<name>/`，软链接按实际内容复制；frontmatter 不合格或同名已存在的跳过并说明原因，不覆盖。只能删除 `~/.tah/skills` 里的。导入 / 删除后当前文件夹的 host 重新加载。

## 远程安装

轻量对齐 Claude Code「从 Git 装 skill」，**不做**完整 `/plugin` marketplace。

```bash
tah skill add anthropics/skills                 # GitHub；装仓库里所有 skill
tah skill add anthropics/skills/skills/pdf      # 只要其中一个
tah skill add anthropics/skills --name pdf      # 同上（可重复 --name）
tah skill add owner/repo#v1.2.0                 # 钉 tag / 分支
tah skill add https://gitlab.com/org/skills.git
tah skill add ./my-skills                       # 本地路径（与 Import 相同）
tah skill add owner/repo --project              # 装进当前目录 skills/
tah skill list
tah skill remove pdf
```

实现：`git clone --depth 1`（可选 `--branch`）到临时目录 → 找 skill 文件夹（自身 / 子目录 / `skills/*` / `.claude-plugin/marketplace.json` 的 `plugins[].skills`）→ 复用 `importSkillsFrom` 拷贝。需要本机有 `git`。同名跳过不覆盖。网页 Settings → Skills 的「Install from Git…」走 `POST /api/skills/add` `{ source }`。

## 测试

- 四层同名优先级
- frontmatter 与 `disable-model-invocation` / `user-invocable`
- catalog 仅摘要；`skill` 返回正文 + resources
- `/name` 与双入口策略（disable-model 只能 slash）
- 资源引用与 `..` 拒绝
- 普通文件夹也读工作目录三处 skills 目录；只监听 skills 目录

## 文档与版本

- 交叉说明：`docs/guide/cli.md`、`docs/design/project-convention.md`、`docs/guide/status.md`、`docs/guide/roadmap.md`（Phase 14）
- `tah init` 写入轻量示例 `skills/hello/SKILL.md`（已存在则跳过）
- 随 **`v0.29.0`** 发布

## 决策摘要

| 项 | 选择 |
| --- | --- |
| 加载模型 | 渐进披露（对齐 Claude / DSH） |
| 入口 | `skill` 工具 + `/name` |
| 路径 | 项目 `skills/` + 只读兼容 `.agents` / `.cursor` + `~/.tah/skills` |
| 资源 | 按需列出引用，不自动执行 |
| 落点 | `packages/cli` 内聚 |
| 安装 | 本地拷贝 + `tah skill add`（GitHub / git URL）；无完整 marketplace UI |
