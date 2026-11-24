# SDK 叙事收口（约定式优先）

状态：📐 已设计（叙事 / 文档面；不改 Runtime API）

定位：tah 对外主卖 **开发者 Runtime/SDK**；默认入口是约定式项目，Runtime API 为进阶；serve / Super-agent / control / desktop 降为可选宿主。

## 背景

产品面已铺很宽（TUI、网页、桌面、Super-agent、渠道、内网控制面）。对外心智容易变成「又一个 agent 产品」，而不是「拿来造自己的 Agent 的 Runtime」。

选定方向：

| 项 | 选择 |
| --- | --- |
| 产品角色 | D — 给开发者用的 Runtime / SDK |
| 默认入口 | C — 约定式项目为主；Runtime API 进阶 |
| 成功标准 | A — 外人 `npx tah init` 后约一小时内做出自己的领域 Agent（有 tools/skills），不读内核源码 |
| 最大洞 | D — 产品面太宽，SDK 心智被冲淡 |
| 收口方式 | **1 — 只改叙事**（不拆包、不砍功能） |

## 目标

1. 外人打开 README / 文档站首页，30 秒内知道：先 `init` 造 Agent，不是先开 serve。
2. 文档与 npm 描述按 **Build → Embed → Hosts** 三层导航。
3. 黄金路径可按清单验收（mock 即可）。
4. L3 能力仍可从 Hosts 文档进入；代码与包边界不变。

## 非目标

- 拆 npm 包、另仓 apps、改 `@typescript-agent-harness/*` 公共 API。
- 删除或冻结 Super-agent / control / desktop / channels 功能。
- 重写 brief-agent 等垂直样板（只降首页权重）。
- 插件市场、厂商 SDK 绑定。

## 三层心智

| 层 | 名字 | 给谁 | 入口 |
| --- | --- | --- | --- |
| L1 | Build an Agent | 默认所有人 | `npx tah init` → `AGENTS.md` / `tools/` / `skills/` → `tah chat` |
| L2 | Embed the Runtime | 嵌进自家产品 | `Runtime` + plugins；可不碰 CLI |
| L3 | Optional hosts | 进阶 / 自用 | `tah serve`、Super-agent、channel-host、control、desktop |

规则：

- README 首页、文档站首页、npm 包描述 **只卖 L1**；L2 链接下沉；L3 收进 Hosts / Advanced。
- 新功能默认进 L3；只有直接服务「一小时做出领域 Agent」的才进 L1。
- 代码不删、不拆包；只改叙事与导航权重。

## 一小时黄金路径

```
npx @typescript-agent-harness/cli init
→ 改 AGENTS.md（人设）
→ 加一个 tools/*.ts（defineTool）
→ 可选加一个 skills/*/SKILL.md
→ npx tah --mock chat   # 或接真实模型
→ 验证：skill / tool 可调、对话不断
```

### 验收清单（文档写死）

- [ ] `init` 成功，目录结构符合约定
- [ ] 改 `tools/` 后热更新生效（或文档标明需重启的例外）
- [ ] skill `/name`（或等价入口）可用
- [ ] mock 下能完成一轮「这是我的 agent」自证对话

## 交付（叙事面）

1. **README.md / README.zh-CN.md**：首屏 = 黄金路径；Runtime 示例移到 Embed；serve / desktop / super-agent → Advanced 链接。
2. **文档站**：侧栏 / 首页分组为 Build · Embed · Hosts（对应 L1/L2/L3）。
3. **最小可抄样板**：比现有 `convention-agent` 更短的 hello 领域 Agent（1 人设 + 1 tool + 1 skill）；或收束 `convention-agent` 本身。`brief-agent` 标为真实垂直样板，不进首屏。
4. **npm `description`（cli）**：主推 convention build agents。
5. **`tah init` 生成物**：短 README / 注释指向黄金路径与验收清单。

## 刻意不改

- `packages/*` 代码边界、版本策略、公共 API
- Super-agent / control / desktop / channels 实现与路径
- 垂直 examples 的业务逻辑

## 验收（本设计整体）

- 新读者打开 README：30 秒内默认动作是 init，不是 serve。
- 按黄金路径清单可在约一小时内（mock）跑通自造 Agent。
- 从 Hosts 文档仍能到达 L3 全部入口。

## 后续

用户批准本文后 → `writing-plans` 拆实施任务（README、侧栏、样板、init 文案、npm description）。
