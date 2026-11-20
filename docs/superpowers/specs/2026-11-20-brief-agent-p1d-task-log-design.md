# brief-agent P1-D：本地任务记录（计费底）

状态：P1-D 已实现。  
选定：**A** — `saveBrief` 成功后追加一行 `out/tasks.jsonl`（不新加工具、不用 SQLite）。

## 目标

每次成功落盘简报记一条本地记录，作为按次计费底账；Skill 忘调也不会漏（挂在 `save_brief` / `saveBrief`）。

## 非目标

- 不计价、不报账、不上传
- 不改 compose / fetch 流程；不新增 `record_task` 工具
- 不读历史 tasks 做业务逻辑（仅追加）

## 落盘

路径：`out/tasks.jsonl`（与 `out/briefs/` 同级）。  
测试：`setBriefOutDirForTest` 生效时写到该目录下的 `tasks.jsonl`。

每行一个 JSON 对象（UTF-8，追加，无 pretty）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `ts` | string | ISO 时间（与 brief 文件名同源 `now`） |
| `template` | `"ops" \| "exec"` | 来自 Brief；缺省按 `ops` |
| `rowIds` | string[] | `brief.rows[].id` 顺序 |
| `jsonPath` | string | 刚写入的 brief JSON 路径 |
| `mdPath` | string | 刚写入的 brief MD 路径 |
| `source` | `"mock" \| "live"` | 当时 `BRIEF_SOURCE`（`activeSource().name`） |
| `market` | `"DE"` | 固定带上，便于以后扩站 |
| `truncated` | boolean | 是否截断目标 |
| `rowCount` | number | `rows.length` |

`validateBrief` 失败则不写 tasks、不写 brief（现状不变）。

## Brief 小改

`composeBrief` 把选用的 `template` 写入 `Brief.template`（可选字段，默认语义仍是 ops），供 save 记账；旧 JSON 无该字段时记 `ops`。

## 返回值

`saveBrief` / `save_brief` 可多返回 `taskLogged: true`（或 `tasksPath`）；不强制 Skill 使用。

## 评测 / 单测

- `lib/save.test.ts`：落盘后 `tasks.jsonl` 多一行且字段正确；校验失败时不追加。
- 现有 eval 仍绿（happy 路径会多写一行，eval 用临时目录或可忽略 tasks）。

## 文档

`AGENTS.md` / README / SKILL：一句「`save_brief` 追加 `out/tasks.jsonl`」。父设计 P1-D 打 ✅。

## 验收

`pnpm test` + `pnpm eval` + `pnpm typecheck` 绿；手动 `pnpm smoke` 后 `out/tasks.jsonl` 多一行。
