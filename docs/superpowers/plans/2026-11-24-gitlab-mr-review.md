# GitLab MR 审阅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review 绑定支持 GitLab MR（PAT）；复用 ReviewPane / `/api/review*`。

**Architecture:** 扩展 `ReviewBinding.provider`；`parseReviewRef`；`fetchGitlabSnapshot`；connectors/`GITLAB_TOKEN` + `GITLAB_HOST`。

**Tech Stack:** TypeScript serve review、connectors、React ReviewPane、`node --test`。

## Global Constraints

- 不改 core / DefaultLoop；无 GitLab OAuth
- Spec: `docs/superpowers/specs/2026-11-24-gitlab-mr-review-design.md`
- Worktree: `.worktrees/dsh-parity-p1`，`feat/dsh-parity-p1`

---

### Task G1: parse + fetch GitLab + binding 类型

**Files:** `packages/cli/src/serve/review.ts`；`connectors.ts`（gitlabReviewToken helper）；tests

- [x] `ReviewBinding.provider: "github"|"gitlab"`；可选 `host`
- [x] `parseReviewRef` / `parseGitlabMrRef`
- [x] `fetchGitlabSnapshot` REST v4
- [x] `gitlabReviewToken(home)` / host resolve
- [x] Commit — `feat(cli): GitLab MR 解析与快照`

---

### Task G2: HTTP bind 兼容 + mock

**Files:** http review routes；tests

- [x] bind 用 parseReviewRef；snapshot 按 provider
- [x] GitHub 回归
- [x] Commit — `feat(cli): review API 支持 GitLab`

---

### Task G3: ReviewPane + Settings PAT

**Files:** ReviewPane.tsx；Settings connectors GitLab；api 文案

- [x] 绑 PR/MR；provider 徽章
- [x] GitLab token (+ optional host) 存 connectors
- [x] Commit — `feat(web): GitLab MR 审阅 UI`

---

### Task G4: Docs

- [x] Spec ✅
- [x] CHANGELOG Unreleased 一行
- [x] `docs/guide/status.md` 可选
- [x] Commit — `docs: GitLab MR 审阅已实现说明`

---

## Order

G1 → G2 → G3 → G4