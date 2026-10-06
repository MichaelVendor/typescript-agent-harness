# Storage 与 Checkpoint

状态：✅ Phase 3（`packages/storage`，Node 22 `node:sqlite`）
没有 artifacts 表，也没有 Drizzle / Kysely。

这是 Agent Runtime 与普通 chatbot framework 的分水岭：**可恢复的执行**。

## 原则

1. 默认 **SQLite**（`node:sqlite`），不上 PostgreSQL  
2. Session 行存完整 `messages_json` / `steps_json`；`events` 表是追加日志  
3. Checkpoint 记录最近完成的 step，支撑 `session.resume()`  

## Storage 接口（当前代码）

```ts
const STORAGE = createServiceKey<StorageService>("storage");

type StorageService = {
  saveSession(row: PersistedSession): Promise<void>;
  getSession(id: string): Promise<PersistedSession | undefined>;
  listSessions(): Promise<PersistedSession[]>;
  appendEvent(event: PersistedEvent): Promise<void>;
  listEvents(sessionId: string): Promise<PersistedEvent[]>;
  saveCheckpoint(row: PersistedCheckpoint): Promise<void>;
  latestCheckpoint(sessionId: string): Promise<PersistedCheckpoint | undefined>;
};
```

`driver: "memory"` 用于测试与无文件场景；`"sqlite"` 为默认。

## 表结构

```
sessions
---------
id
status
max_steps
messages_json
steps_json
created_at
updated_at

events
------
id
session_id
type
payload_json
created_at

checkpoints
-----------
id
session_id
step_id
step_type
message_count
created_at
```

`events` 为追加写；不要原地改历史事件。

## Checkpoint / Resume

场景：

```
Step 1 ✓
Step 2 ✓
Step 3 ✓
Step 4 → 进程在 tool 中途退出
```

```ts
const session = await runtime.get(SESSION).get(sessionId);
await session.resume();
```

规则（当前实现）：

- 每个已完成的 LLM / tool step 后写 checkpoint  
- 进程退出时若状态仍是 `running`，下次加载会标成 `failed`，再 `resume()`  
- 未完成的 **tool 调用优先重跑**，然后继续 Loop  
- Checkpoint 不含密钥  

## Resume vs Replay

| 概念 | 含义 |
| --- | --- |
| Resume | 从中断点继续执行（副作用可能再次发生） |
| Replay | 只读重放事件流（🧭 未做独立 API） |

## 与 EventBus 的关系

| 通道 | 存活期 | 用途 |
| --- | --- | --- |
| EventBus | 进程内、实时 | CLI 打印、metrics |
| Event Store | 持久 | resume、audit |

先写 store，再 `emit("storage.checkpoint")`，避免订阅者读到尚未落盘的状态。

## 配置

```ts
runtime.use(
  storagePlugin({
    driver: "sqlite",
    path: ".tah/data.db",
  }),
);
```

CLI：`pnpm tah -- run --persist --mock "..."` 会挂 SQLite。
