# AgentTeam UX（Room 网页面）

状态：📐 已设计（待计划 / 实现）

在已有 `createRoom` 旁路上做具名团队 + 群聊网页；Settings 最小建队。不改 `DefaultLoop` / `packages/core`。

系列：① 跨会话 ✅ → ② 本文 → ③ GitLab MR。

## 目标

1. `tah serve --room`：主区 Chat | Room（可与 Timeline 并存）。
2. Room UI：成员列表、群聊转录、用户发消息、Step 推进回合。
3. Settings → Team：编辑成员 → `tah.team.json`；缺省内置 `tl` + `researcher`。

## 非目标

- 多成员并行回合、嵌套群、IM、完整工具白名单可视化。
- 改 DefaultLoop / 替换 `run_subagent`。
- GitLab（下一项）。

## 原则

| 项 | 选择 |
| --- | --- |
| 引擎 | 复用 `packages/agent` `createRoom` |
| 入口 | `--room` → `info.room` |
| 配置 | `tah.team.json` + Settings 最小表单 |
| 模型 | `--mock` stub runner；真模型接现有 Session turn runner 模式 |

## 方案

**A：** serve 内嵌一间 Room + Settings Team 卡（已选）。

## 数据 / API

**`tah.team.json`**
```json
{ "members": [{ "id": "tl", "displayName": "TL", "persona": "…" }, { "id": "researcher", "displayName": "Researcher", "persona": "…" }] }
```
必须含 `id: "tl"`。缺失 → 内置默认队。

**Settings**
- `GET /api/settings/team` → `{ members }`
- `POST /api/settings/team` → 校验并写入 `tah.team.json`

**Room HTTP（仅 `--room`）**
- `GET /api/room` → `{ meta, messages }`
- `POST /api/room/goal` `{ text }` → 开场 / 新目标并进入调度
- `POST /api/room/message` `{ text }` → 用户插话
- `POST /api/room/step` → 推进一轮（TL 或 active member）
- Persist：`.tah/room/`（transcript.jsonl + meta.json）

## UI

- 顶栏：有 `info.room` 时显示 Room 页签。
- Room：成员轨 + 转录 + 输入 / Send / Step / New goal；状态条 `status` / `activeMember`。
- Settings → Team：增删改 id / displayName / persona；保存落盘。新目标起用新队。

## 验收

- `--room --mock`：goal → step 见 delegate/result 序；Team 保存后文件正确。
- 无 `--room`：无 Room 页签；Team 配置仍可编辑。
- core / DefaultLoop 无变更。

## 实现分期（计划占位）

1. team.json 读写 + Settings API/UI  
2. serve Room embed + HTTP + mock runner  
3. Web Room 页 + 顶栏切换  
4. Docs  

## 与已有文档

| 文档 | 关系 |
| --- | --- |
| `2026-11-06-agent-room-min-design.md` | Room 协议权威；本文加 serve/web |
| Super-agent / Timeline | 正交；顶栏可并存 |
| 跨会话 deliver | 正交 |
