# GitLab MR 审阅

状态：📐 已设计（待计划 / 实现）

对称扩展现有 GitHub Code Review 绑定：支持 GitLab MR（PAT）。不改 `DefaultLoop` / `packages/core`。不做 GitLab OAuth。

系列：① 跨会话 ✅ → ② AgentTeam ✅ → ③ 本文。

## 目标

1. 解析并绑定 GitLab MR（URL 或 `namespace/project!iid`）。
2. 拉取标题 / 状态 / 文件列表 / diff 预览（截断同 GitHub）。
3. PAT：connectors `provider: "gitlab"` 或 `GITLAB_TOKEN`；host 默认 `https://gitlab.com`，可用 `GITLAB_HOST`。

## 非目标

- GitLab OAuth、approve/merge 写回、行内评论。
- 改 DefaultLoop / core。

## 原则

| 项 | 选择 |
| --- | --- |
| API | 扩展现有 `/api/review*` + `ReviewBinding` |
| 认证 | PAT only |
| Host | gitlab.com + 可选自建 |
| UI | 复用 ReviewPane |

## 方案

**A：** `provider: "github" | "gitlab"` + `parseReviewRef` 自动识别（已选）。

## 数据 / API

```ts
type ReviewBinding = {
  provider: "github" | "gitlab";
  owner: string;   // GitLab: namespace（可含 /）
  repo: string;
  number: number;  // MR iid
  title?: string;
  url: string;
  boundAt: number;
  host?: string;   // gitlab；默认 https://gitlab.com
};
```

- `parseReviewRef(input)`：GitHub URL / `owner/repo#n`；GitLab  
  `https://<host>/<ns>/<project>/-/merge_requests/<iid>` 或 `ns/project!iid`。
- `POST /api/review/bind` `{ ref }` 不变；内部选 provider。
- `fetchReviewSnapshot`：GitLab REST v4 + `PRIVATE-TOKEN`；project id URL-encode `owner/repo`。
- Token：connectors gitlab PAT → `GITLAB_TOKEN`；host：binding.host → `GITLAB_HOST` → gitlab.com。
- 无 token：清晰错误；可选 mock fixture（与 GitHub 对称）。

## UI

- ReviewPane：绑 PR/MR；provider 徽章。
- Settings → Connectors：GitLab PAT（+ 可选 host）；env 仍可用。

## 验收

- 解析 MR URL / `group/proj!1`；有 PAT 可读快照；GitHub 回归；core 无变更。

## 实现分期（计划占位）

1. parse + fetch gitlab + binding 类型  
2. HTTP / mock 兼容  
3. ReviewPane + Settings PAT  
4. Docs  

## 与已有文档

| 文档 | 关系 |
| --- | --- |
| P1 Code Review | GitHub 首发；本文第二家 |
| connectors | token 账号；非 oauth |
