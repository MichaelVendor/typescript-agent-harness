# DSH 对照升级（P1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地会话未读、GitHub PR 审阅绑定（mock→PAT→OAuth）、connectors OAuth、钉钉/企微渠道——对齐 DSH P1 工作流，不换框架。

**Architecture:** 旁路 serve/web + `packages/channels` + 扩展 `connectors.ts`。Code Review 绑在当前 workspace；未读先 localStorage；OAuth 本机回调；钉钉/企微走 channel-host / serve 嵌入路径与现有 IM 一致。

**Tech Stack:** 现有 TypeScript monorepo、`node:http`、React web、GitHub REST、`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-23-dsh-parity-p1-design.md`  
**Depends on:** P0 已在 `feat/dsh-parity-p0`（合并后再开本 P1 分支，或基于该分支继续）。

## Global Constraints

- **不改** `DefaultLoop`、`packages/core` Plugin 作用域；不引入 NestJS/Cordis。
- Commits 走 `~/.cursor/skills/code-commit/SKILL.md`；never push unless user asks；never `--no-verify`；不提交密钥 / `.superpowers/`。
- 每个 Task 后相关包 build + 聚焦测试通过。
- GitLab / Timeline 树 / AgentTeam 产品 **不在本计划**。

## 文件结构（整包）

| 文件 | 职责 |
| --- | --- |
| `packages/web/src/unread.ts` + Sidebar/Workers | 未读存取与圆点 |
| `packages/cli/src/serve/review.ts` | 绑定 / 拉 PR 快照 |
| `packages/cli/src/serve/http.ts` | `/api/review*`、`/api/connectors/oauth*` |
| `packages/web/src/components/ReviewPane.tsx` | 审阅 UI |
| `packages/cli/src/connectors.ts` | `authKind: "oauth"` + refresh 字段 |
| `packages/cli/src/connectors-oauth.ts` | start/callback/refresh |
| `packages/channels/src/dingtalk.ts` / `wecom.ts` | 适配器 |
| Settings Messaging | 钉钉/企微开关 |

---

## Phase B — 会话未读（先做，最小）

### Task B1: unread store + Workers 圆点

**Files:**
- Create: `packages/web/src/unread.ts`
- Modify: `packages/web/src/App.tsx`（Workers 列表）
- Test: `packages/web/test/unread.test.ts`

**Interfaces:**
```ts
export function loadUnread(origin: string): Record<string, true>;
export function markUnread(origin: string, id: string): void;
export function clearUnread(origin: string, id: string): void;
```

- [ ] **Step 1:** Failing tests — mark/clear/load round-trip（可用 memory mock `localStorage`）。
- [ ] **Step 2:** Implement `unread.ts`（key `tah.unread.${origin}`）。
- [ ] **Step 3:** 在 SSE 处理：非焦点 `attention` 或带 `workerId` 的 `turn.end` → `markUnread`；`onFocusWorker` / focus 事件 → `clearUnread`。
- [ ] **Step 4:** Workers 行：未读显示圆点（`worker-chip` 或 CSS dot）。
- [ ] **Step 5:** Commit — `feat(web): worker 未读圆点`

### Task B2: 侧栏 session 未读（可选同迭代）

**Files:** `packages/web/src/components/Sidebar.tsx`、`state.ts`

- [ ] 若 session 事件易挂：非当前 session 的 `turn.end` 标未读；点入清除。难接则 **跳过** 并在报告写明，不阻塞 Phase A。
- [ ] Commit — `feat(web): 侧栏会话未读` 或跳过。

**Phase B 完成标准:** 并行两 worker，后台跑完/attention 时非焦点有点；点入消失。

---

## Phase A — Code Review 绑定

### Task A1: ReviewBinding 存储 + mock 快照

**Files:**
- Create: `packages/cli/src/serve/review.ts`
- Test: `packages/cli/test/review.test.ts`

**Interfaces:**
```ts
export type ReviewBinding = {
  provider: "github";
  owner: string;
  repo: string;
  number: number;
  title?: string;
  url: string;
  boundAt: number;
};
export type ReviewSnapshot = ReviewBinding & {
  body?: string;
  state?: string;
  files: Array<{ path: string; status?: string }>;
  diffPreview?: string; // truncated
};
export function parseGithubPrRef(input: string): { owner: string; repo: string; number: number };
export function bindReview(cwd: string, binding: ReviewBinding): void;
export function loadReviewBinding(cwd: string): ReviewBinding | null;
export function clearReviewBinding(cwd: string): void;
export async function fetchReviewSnapshot(
  binding: ReviewBinding,
  opts: { mock?: ReviewSnapshot; token?: string },
): Promise<ReviewSnapshot>;
```

- [ ] **Step 1:** Tests — parse URL/`owner/repo#n`；bind/load/clear 写 `.tah/review-binding.json`；mock fetch 返回 files。
- [ ] **Step 2:** Implement；mock 路径不访问网络。
- [ ] **Step 3:** Commit — `feat(cli): ReviewBinding 与 mock PR 快照`

### Task A2: HTTP `/api/review*`

**Files:** `packages/cli/src/serve/http.ts`、`protocol.ts`；test `serve-review.test.ts`

- [ ] `POST /api/review/bind` `{ ref: string }` → parse + mock snapshot + bind  
- [ ] `GET /api/review` → snapshot（无绑定 404）  
- [ ] `POST /api/review/clear`  
- [ ] Commit — `feat(cli): review HTTP API`

### Task A3: Web ReviewPane + 绑 PR

**Files:**
- Create: `packages/web/src/components/ReviewPane.tsx`
- Modify: `App.tsx` / session rail；`api.ts`

- [ ] 右栏卡片：标题、state、文件列表、diffPreview（折叠）  
- [ ] 「绑 PR…」prompt 输入 URL → `api.reviewBind`  
- [ ] 有绑定时 composer 上方一行 notice：`Reviewing owner/repo#n`  
- [ ] Commit — `feat(web): PR 审阅绑定面板`

### Task A4: PAT 真源（可选接 C 前）

**Files:** `review.ts`；connectors `provider: "github"`

- [ ] `fetchReviewSnapshot` 无 mock 时用 `readConnectorSecret(home, githubId)` 调 GitHub REST  
- [ ] 无 token → 清晰 401/配置提示  
- [ ] Commit — `feat(cli): GitHub PAT 拉 PR 快照`

**Phase A 完成标准:** mock 可绑可看；有 PAT 时可拉真 PR（A4）。

---

## Phase C — Connectors OAuth（GitHub）

### Task C1: 存储模型扩展

**Files:** `packages/cli/src/connectors.ts` + tests

- [ ] `authKind: "token" | "oauth"`  
- [ ] oauth 存：`accessToken`、`refreshToken?`、`expiresAt?`、`scopes?`（文件 0600；对外仍 hint）  
- [ ] `upsertConnectorOAuth` / `readConnectorSecret` 兼容 oauth access  
- [ ] Commit — `feat(cli): connectors 支持 oauth 账号`

### Task C2: OAuth start/callback

**Files:** `packages/cli/src/connectors-oauth.ts`；`serve/http.ts`；Settings UI

**环境：** `TAH_GITHUB_CLIENT_ID` / `TAH_GITHUB_CLIENT_SECRET`（或 settings 非 secret 的 clientId + connectors 存 secret——优先 env）。

- [ ] `GET /api/connectors/oauth/start?provider=github` → redirect URL + state  
- [ ] callback 换 token → upsert oauth 账号  
- [ ] Settings：按钮「连接 GitHub」/「断开」  
- [ ] Commit — `feat(cli): GitHub OAuth 本机回调`

### Task C3: Review 优先用 oauth 账号

- [ ] `fetchReviewSnapshot`：oauth github → PAT token 账号 → 错误  
- [ ] Commit — `feat(cli): Review 使用 GitHub oauth`

**Phase C 完成标准:** 本机走通一次 GitHub OAuth（或文档写明需注册 OAuth App）；Review 可用该账号。

---

## Phase D — 钉钉 / 企微

### Task D1: 钉钉适配器 + mock

**Files:** `packages/channels/src/dingtalk.ts`；host 注册；tests

- [ ] 入站 → `toSuperAgentEvent`；出站 send  
- [ ] `--mock-channel` 可演  
- [ ] Commit — `feat(channels): 钉钉适配器`

### Task D2: 企微适配器 + mock

- [ ] 同上  
- [ ] Commit — `feat(channels): 企微适配器`

### Task D3: Settings Messaging 接线

- [ ] 开关 + connectors token 字段；`tah.channels.json` 启用位  
- [ ] Commit — `feat(cli): Messaging 钉钉/企微`

**Phase D 完成标准:** mock 闭环；真凭证可选测。

---

## Phase E — 文档

- [x] Spec 状态 → ✅（各 Phase 绿后）  
- [x] `CHANGELOG` Unreleased / 发版时条目  
- [x] `docs/guide/status.md` 一行  
- [x] Commit — `docs: DSH 对照 P1 已实现说明`

**Note:** B2（侧栏 session 未读）跳过；A4 PAT 真源由 C3（oauth→PAT）覆盖。

---

## Self-review

| Spec | Tasks |
| --- | --- |
| 未读 | B1–B2 |
| Code Review | A1–A4 |
| OAuth | C1–C3 |
| 钉钉/企微 | D1–D3 |
| 不改 core/DefaultLoop | Global |
| Timeline / AgentTeam / GitLab | 明确排除 |

## 推荐执行顺序

**B1 → A1 → A2 → A3 → B2? → C1 → C2 → A4/C3 → D1 → D2 → D3 → E**
