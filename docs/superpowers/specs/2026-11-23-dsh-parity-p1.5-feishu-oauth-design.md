# DSH 对照升级（P1.5）— 飞书 OAuth

状态：📐 已设计（待计划 / 实现）

在 P1 GitHub OAuth 之上，为 connectors 增加第二家 **飞书用户授权**。**不**换 core / DefaultLoop；**不**替代 Messaging 机器人 App 密钥。

前序：`docs/superpowers/specs/2026-11-23-dsh-parity-p1-design.md`（✅ C 段）；Timeline：`2026-11-23-dsh-parity-p1.5-timeline-design.md`。

## 目标

1. Settings「连接飞书」→ 本机 OAuth 回调 → `feishu.oauth` 账号（user access token）。
2. 与 GitHub 对称：同一 `start` / `callback` 路由，按 `provider` 分支。
3. Messaging 飞书机器人（`tah.channels.json` + appId/secret）保持独立。

## 非目标

- 用 OAuth 替换或自动写入 Messaging 机器人凭证。
- 自动 refresh 产品化（可入库 `refresh_token`，本迭代可不自动刷）。
- Lark 多区域产品化（仅 env 可选 host）。
- 改飞书 channel 入站适配器、人审写回 IM。

## 原则

| 项 | 选择 |
| --- | --- |
| 模式 | 对齐 GitHub：`TAH_FEISHU_CLIENT_*` + 本机 `127.0.0.1` callback |
| 回退 | 缺省可用 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` |
| Host | 默认 `open.feishu.cn`；`TAH_FEISHU_OAUTH_HOST` 可改 `open.larksuite.com` |
| 账号 id | `feishu.oauth`，`provider: "feishu"` |

## 方案

扩展 `packages/cli/src/connectors-oauth.ts` + 现有 HTTP oauth 路由；Settings 并排飞书卡。不新开独立 oauth 服务模块前缀。

## 数据 / API

**凭证**

```text
clientId     = TAH_FEISHU_CLIENT_ID     || FEISHU_APP_ID
clientSecret = TAH_FEISHU_CLIENT_SECRET || FEISHU_APP_SECRET
oauthHost    = TAH_FEISHU_OAUTH_HOST    || open.feishu.cn
```

**账号**

```ts
upsertConnectorOAuth({
  id: "feishu.oauth",
  provider: "feishu",
  label: "飞书",
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number,
  scopes?: string[],
});
```

**HTTP**

- `GET /api/connectors/oauth/start?provider=feishu|github` — 飞书时返回飞书 authorize URL；未配置 → 503。
- `GET /api/connectors/oauth/callback` — 按 `oauthStates.get(state).provider` 换 token；飞书成功页 `postMessage("tah:feishu-connected")`。
- `redirect_uri` = `http://127.0.0.1:<servePort>/api/connectors/oauth/callback`（与 GitHub 相同，OAuth 应用须登记该回调）。

**connectors-oauth**

- `buildFeishuOAuthUrl` / `exchangeFeishuOAuthCode`（飞书开放平台：先拿 app_access_token，再 `authen/v1/oidc/access_token` 或文档现行 user_access_token 交换；实现以官方最新为准，单测 mock fetch）。
- State 生成可与 GitHub 共用 `createGithubOAuthState` 或改名为通用 `createOAuthState`。

## UI

- Settings → Connectors：飞书卡（hint / 连接 / 断开），旁路 GitHub。
- `api.oauthStart(provider?: "github" | "feishu")`。
- 监听 `tah:feishu-connected` → 刷新 settings。
- 断开：`removeConnector({ id: "feishu.oauth" })`。

## 验收

- start?provider=feishu 含正确 host / redirect_uri / state。
- callback mock → connectors 有 `feishu.oauth`；UI 仅 hint。
- Messaging 飞书字段不变；GitHub OAuth 回归绿。
- 单测 URL + exchange；不改 DefaultLoop / core。

## 实现分期（计划占位）

1. `connectors-oauth` 飞书 helpers + 单测  
2. HTTP start/callback 分支  
3. Settings UI + api  
4. Docs / CHANGELOG  

## 与已有文档

| 文档 | 关系 |
| --- | --- |
| P1 C OAuth | GitHub 首发；本文第二家 |
| channel-host / Messaging | 机器人密钥独立；本账号不驱动 polling |
| Timeline P1.5 | 正交 |
