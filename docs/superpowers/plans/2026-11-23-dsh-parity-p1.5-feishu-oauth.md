# DSH P1.5 飞书 OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings 可「连接飞书」经本机 OAuth 写入 `feishu.oauth`，与 GitHub 对称；不替代 Messaging 机器人密钥。

**Architecture:** 扩展 `connectors-oauth.ts` + 现有 `/api/connectors/oauth/start|callback` 按 provider 分支；Settings 并排飞书卡。凭证：`TAH_FEISHU_CLIENT_*` 回退 `FEISHU_APP_*`。

**Tech Stack:** TypeScript、node:http serve、React Settings、`node --test`。

## Global Constraints

- 不改 `packages/core` / `DefaultLoop`
- 不改飞书 channel 入站；Messaging app 字段独立
- Conventional Commits + code-commit
- Worktree：`.worktrees/dsh-parity-p1`，分支 `feat/dsh-parity-p1`
- Spec：`docs/superpowers/specs/2026-11-23-dsh-parity-p1.5-feishu-oauth-design.md`

## File map

| File | Role |
| --- | --- |
| `packages/cli/src/connectors-oauth.ts` | Feishu URL + token exchange |
| `packages/cli/src/serve/http.ts` | start/callback provider 分支 |
| `packages/web/src/api.ts` | `oauthStart(provider)` |
| `packages/web/src/components/Settings.tsx` | 飞书 Connect/Disconnect |

---

### Task F1: Feishu OAuth helpers

**Files:**
- Modify: `packages/cli/src/connectors-oauth.ts`
- Test: `packages/cli/test/connectors-oauth.test.ts`

**Interfaces:**
```ts
export function resolveFeishuOAuthCredentials(env?: NodeJS.ProcessEnv): { clientId: string; clientSecret: string; host: string } | null;
export function buildFeishuOAuthUrl(input: { clientId: string; redirectUri: string; state: string; host?: string }): string;
export async function exchangeFeishuOAuthCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string; host?: string },
  fetchImpl?: OAuthFetch,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[] }>;
```
- Host default `open.feishu.cn`
- Exchange: mockable；实现走飞书开放平台 user_access_token 交换（app_access_token → oidc/access_token 或现行等价 API）

- [ ] 单测 URL 含 host/redirect/state；exchange mock 成功/失败
- [ ] 实现 helpers
- [ ] Commit — `feat(cli): 飞书 OAuth URL 与换票`

---

### Task F2: HTTP start/callback 分支

**Files:**
- Modify: `packages/cli/src/serve/http.ts`
- Test: extend oauth tests if any (`packages/cli/test/connectors-oauth.test.ts` or serve test)

- [ ] `start?provider=feishu|github`；feishu 未配置 503
- [ ] callback 按 pending.provider 换票；upsert `feishu.oauth`；成功页 `tah:feishu-connected`
- [ ] GitHub 路径回归
- [ ] Commit — `feat(cli): oauth start/callback 支持飞书`

---

### Task F3: Settings UI

**Files:**
- Modify: `packages/web/src/api.ts` — `oauthStart(provider?: "github"|"feishu")`
- Modify: `packages/web/src/components/Settings.tsx`
- Optional i18n strings in `settings.en.ts`

- [ ] 飞书卡：连 / 断 / hint；监听 `tah:feishu-connected`
- [ ] typecheck + web tests
- [ ] Commit — `feat(web): Settings 连接飞书 OAuth`

---

### Task F4: Docs

- [x] Spec 状态 → ✅
- [x] CHANGELOG Unreleased 一行
- [x] `docs/guide/status.md` 可选
- [x] Commit — `docs: DSH P1.5 飞书 OAuth 已实现说明`

---

## Self-review

| Spec | Tasks |
| --- | --- |
| helpers + env | F1 |
| HTTP | F2 |
| Settings | F3 |
| Messaging 不动 | Global |
| 不改 core | Global |

**Order:** F1 → F2 → F3 → F4
