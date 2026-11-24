# Meeting Actions Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建约定式样板 `examples/meeting-actions-agent`：纪要 → 行动项 → `ask_user`/confirm → 落盘；smoke/eval 可无真模型验收。

**Architecture:** 逻辑在 `lib/`（schema、extract、compose、confirm、save、markdown）；`tools/*.ts` 仅 `defineTool` 薄包装。smoke/eval 直接调 `lib/`，不经 LLM。对齐 `examples/brief-agent`。

**Tech Stack:** TypeScript、`@typescript-agent-harness/cli` `defineTool`、`node --test`、`node --experimental-strip-types`。

**Spec:** `docs/superpowers/specs/2026-11-24-meeting-actions-agent-design.md`

## Global Constraints

- 不改 `packages/*` Runtime / DefaultLoop / ask_user 实现
- 仅新增 `examples/meeting-actions-agent/**`；可选一句 getting-started 链接
- 无证据不填 `owner`；`save_actions` 默认拒绝未确认且 action.owner==null
- 禁止日历/IM/Super-agent；工具名不用保留名 `ask_user`
- Conventional Commits；不 push（除非用户另说）

## File map

| File | Role |
| --- | --- |
| `examples/meeting-actions-agent/lib/schema.ts` | 类型 + validate |
| `examples/meeting-actions-agent/lib/extract.ts` | 规则抽取（fixture 确定性） |
| `examples/meeting-actions-agent/lib/compose.ts` | 草稿 Markdown / 表 |
| `examples/meeting-actions-agent/lib/confirm.ts` | 合并确认 |
| `examples/meeting-actions-agent/lib/save.ts` | 落盘 + tasks.jsonl + 门禁 |
| `examples/meeting-actions-agent/lib/*.test.ts` | 单测 |
| `examples/meeting-actions-agent/tools/*.ts` | defineTool 包装 |
| `examples/meeting-actions-agent/skills/meeting-to-actions/SKILL.md` | 流程 |
| `examples/meeting-actions-agent/data/fixtures/*.txt` | 虚构转写 |
| `examples/meeting-actions-agent/scripts/smoke.ts` | 无模型冒烟 |
| `examples/meeting-actions-agent/eval/run-eval.ts` | 黄金路径 |
| `AGENTS.md` / `README.md` / `package.json` / `tah.config.json` / `tsconfig.json` | 项目壳 |

---

### Task 1: Scaffold + schema + fixture

**Files:**
- Create: `examples/meeting-actions-agent/package.json`
- Create: `examples/meeting-actions-agent/tsconfig.json`
- Create: `examples/meeting-actions-agent/tah.config.json`
- Create: `examples/meeting-actions-agent/lib/schema.ts`
- Create: `examples/meeting-actions-agent/lib/schema.test.ts`
- Create: `examples/meeting-actions-agent/data/fixtures/standup-zh.txt`
- Create: `examples/meeting-actions-agent/.gitignore`（`node_modules`、`.env`、`.tah`、`out`）

**Interfaces:**
- Produces: `ActionKind`, `ActionRow`, `ExtractResult`, `validateExtractResult(result): string[]`

- [ ] **Step 1: Write failing schema test**

```ts
// lib/schema.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateExtractResult } from "./schema.ts";

test("rejects action row without evidence", () => {
  const problems = validateExtractResult({
    rows: [{
      id: "a1", kind: "action", text: "改登录页",
      owner: null, due: null, priority: null, evidence: "",
    }],
    gaps: [],
  });
  assert.ok(problems.some((p) => /evidence/i.test(p)));
});

test("accepts null owner", () => {
  const problems = validateExtractResult({
    rows: [{
      id: "a1", kind: "action", text: "改登录页",
      owner: null, due: null, priority: "P1",
      evidence: "张三：我来改登录页",
    }],
    gaps: ["a1 缺负责人"],
  });
  assert.equal(problems.length, 0);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```sh
cd examples/meeting-actions-agent && node --test --experimental-strip-types lib/schema.test.ts
```

- [ ] **Step 3: Implement schema + scaffold files**

`lib/schema.ts` — export kinds `"decision"|"action"|"info"`, `ActionRow`, `ExtractResult`, `validateExtractResult`（空 evidence 报错；kind 非法报错）。

`package.json`:

```json
{
  "name": "@typescript-agent-harness/example-meeting-actions-agent",
  "private": true,
  "version": "1.7.5",
  "type": "module",
  "scripts": {
    "start": "tah chat",
    "typecheck": "tsc -p tsconfig.json",
    "smoke": "node --experimental-strip-types scripts/smoke.ts",
    "eval": "node --experimental-strip-types eval/run-eval.ts",
    "test": "node --test --experimental-strip-types \"lib/**/*.test.ts\""
  },
  "devDependencies": {
    "@types/node": "^22.18.0",
    "@typescript-agent-harness/cli": "workspace:*",
    "typescript": "^5.9.2"
  }
}
```

`tsconfig.json` — 同 brief-agent（extends `../../tsconfig.base.json`，include tools/lib）。

`tah.config.json`: `{ "capabilities": { "coding": true } }`

Fixture `standup-zh.txt`（虚构，含：明确决议、有名有姓行动、无名行动、纯信息）：

```text
站会 2026-11-24
李华：登录页这周我改，周五前给测试。
王芳：决议——下周一上线支付灰度。
（无人认领）谁去更新帮助文档？
周杰：API 延迟昨天降到 80ms 了。
```

- [ ] **Step 4: Tests pass**

```sh
cd examples/meeting-actions-agent && node --test --experimental-strip-types lib/schema.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add examples/meeting-actions-agent
git commit -m "$(cat <<'EOF'
feat(examples): meeting-actions scaffold 与 schema

EOF
)"
```

---

### Task 2: extract + compose (lib) TDD

**Files:**
- Create: `lib/extract.ts`, `lib/extract.test.ts`
- Create: `lib/compose.ts`, `lib/compose.test.ts`

**Interfaces:**
- Consumes: `ExtractResult` / `ActionRow`
- Produces:
  - `extractActions(text: string): ExtractResult`
  - `composeDraft(result: ExtractResult): { markdown: string; pendingOwnerIds: string[] }`

- [ ] **Step 1: Failing extract test against fixture**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractActions } from "./extract.ts";
import { validateExtractResult } from "./schema.ts";

const fixture = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/standup-zh.txt"),
  "utf8",
);

test("fixture: named owner vs null owner; no invented names", () => {
  const r = extractActions(fixture);
  assert.equal(validateExtractResult(r).length, 0);
  const login = r.rows.find((x) => /登录/.test(x.text));
  assert.ok(login);
  assert.equal(login!.owner, "李华");
  const help = r.rows.find((x) => /帮助文档/.test(x.text));
  assert.ok(help);
  assert.equal(help!.owner, null);
  assert.ok(r.gaps.some((g) => /帮助文档|负责人/.test(g)));
  assert.ok(r.rows.some((x) => x.kind === "decision" && /支付灰度/.test(x.text)));
  assert.ok(r.rows.some((x) => x.kind === "info" && /80ms/.test(x.text)));
});
```

实现策略（确定性规则，YAGNI）：
- 按行扫描；`决议`/`决定` → decision；问句且无人名 → action owner null；`某人：…我来/我改` → 抽中文名作 owner；纯状态数字 → info。
- 每行 `evidence` = 原行 trim；`id` = `a1`…；gaps 收集 owner==null 的 action。

- [ ] **Step 2: Run extract test — FAIL then implement — PASS**

- [ ] **Step 3: compose test**

```ts
test("compose marks pending owners", () => {
  const { markdown, pendingOwnerIds } = composeDraft({
    meetingTitle: "站会",
    rows: [
      { id: "a1", kind: "action", text: "改登录页", owner: "李华", due: null, priority: "P1", evidence: "…" },
      { id: "a2", kind: "action", text: "更新帮助文档", owner: null, due: null, priority: null, evidence: "…" },
    ],
    gaps: ["a2 缺负责人"],
  });
  assert.deepEqual(pendingOwnerIds, ["a2"]);
  assert.match(markdown, /待确认/);
  assert.match(markdown, /更新帮助文档/);
});
```

`composeDraft` 输出含标题、表格（id/kind/text/owner/due/priority）、待确认列表、缺口。

- [ ] **Step 4: Commit**

```bash
git add examples/meeting-actions-agent/lib
git commit -m "$(cat <<'EOF'
feat(examples): meeting-actions extract/compose

EOF
)"
```

---

### Task 3: confirm + save gate TDD

**Files:**
- Create: `lib/confirm.ts`, `lib/confirm.test.ts`
- Create: `lib/save.ts`, `lib/save.test.ts`

**Interfaces:**
- `confirmActions(result, patches: Array<{ id: string; owner?: string|null; priority?: ActionRow["priority"] }>): ExtractResult` — 设 `confirmed: true` 元数据（可在 `ExtractResult` 上加 `confirmed?: boolean`，或另包 `ConfirmedBatch`）。**采用：**

```ts
export type ActionBatch = ExtractResult & { confirmed: boolean };

export function confirmActions(
  result: ExtractResult | ActionBatch,
  patches: Array<{ id: string; owner?: string | null; priority?: "P0"|"P1"|"P2"|null }>,
): ActionBatch;
```

- `saveActions(batch: ActionBatch, opts?: { allowUnowned?: boolean; outDir?: string }): { mdPath: string; jsonPath: string }`
  - 若存在 `kind==="action" && owner==null` 且未 `allowUnowned` 且 `!batch.confirmed` → throw
  - **按 spec：默认拒绝未确认且仍有 action.owner==null**；确认后仍允许 owner null 仅当 `allowUnowned: true`，否则确认后仍缺 owner 也 throw（逼 ask_user 补全或显式放行）。
  - 更贴 spec 的门禁：

```ts
// save_actions:
// 1) if !batch.confirmed → throw "not confirmed"
// 2) if any action.owner==null && !allowUnowned → throw "unowned actions"
// 3) write out/actions/<ts>.md + .json; append out/tasks.jsonl
```

smoke 注入 confirm 补全所有 action owner 后再 save。

- [ ] **Step 1: Tests**

```ts
test("save rejects unconfirmed batch", () => {
  assert.throws(() => saveActions({ rows: [], gaps: [], confirmed: false }));
});

test("save rejects confirmed batch with null action owner unless allowUnowned", () => {
  const batch = {
    confirmed: true,
    gaps: [],
    rows: [{ id: "a1", kind: "action" as const, text: "x", owner: null, due: null, priority: null, evidence: "e" }],
  };
  assert.throws(() => saveActions(batch));
  const saved = saveActions(batch, { allowUnowned: true, outDir: /* tmp */ });
  assert.match(saved.mdPath, /actions/);
});

test("confirm patches owner and sets confirmed", () => {
  const batch = confirmActions(
    { rows: [{ id: "a1", kind: "action", text: "x", owner: null, due: null, priority: null, evidence: "e" }], gaps: [] },
    [{ id: "a1", owner: "周杰", priority: "P2" }],
  );
  assert.equal(batch.confirmed, true);
  assert.equal(batch.rows[0].owner, "周杰");
});
```

用 `fs.mkdtempSync` 作 `outDir`。

- [ ] **Step 2: Implement confirm.ts + save.ts — tests PASS**

- [ ] **Step 3: Commit**

```bash
git add examples/meeting-actions-agent/lib
git commit -m "$(cat <<'EOF'
feat(examples): meeting-actions confirm/save 门禁

EOF
)"
```

---

### Task 4: tools + skill + AGENTS + smoke/eval + README

**Files:**
- Create: `tools/extract-actions.ts`, `compose-draft.ts`, `confirm-actions.ts`, `save-actions.ts`
- Create: `skills/meeting-to-actions/SKILL.md`
- Create: `AGENTS.md`, `README.md`
- Create: `scripts/smoke.ts`, `eval/run-eval.ts`
- Modify (optional): `docs/guide/getting-started.md` — 进阶样板加一行 meeting-actions

**Interfaces:** tools 只调 lib；文件名 → 工具名 `extract_actions` 等。

- [ ] **Step 1: Tool wrappers**（模式同 brief-agent `compose-brief.ts`）

```ts
import { defineTool } from "@typescript-agent-harness/cli";
import { extractActions } from "../lib/extract.ts";
import { validateExtractResult } from "../lib/schema.ts";

export default defineTool({
  description: "从会议转写/纪要原文抽取行动项、决议与信息项。缺负责人填 null，写入 gaps。",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  async execute(input: { text?: string }) {
    const result = extractActions(String(input.text ?? ""));
    return { result, problems: validateExtractResult(result) };
  },
});
```

另三个工具同理：`compose_draft({ result })`、`confirm_actions({ result, patches })`、`save_actions({ batch, allowUnowned? })`。

- [ ] **Step 2: SKILL.md**

```markdown
---
name: meeting-to-actions
description: 把会议转写或纪要整理成行动项；缺负责人时先问用户再落盘。
---

# 会议 → 行动项

1. `extract_actions`（全文）
2. `compose_draft`
3. 若有缺负责人/优先级：内置 `ask_user`（2–5 选项）；再 `confirm_actions`
4. `save_actions`（不要 allowUnowned，除非用户明确说可以无负责人）
5. 回复四块：结论 / 行动项表（贴工具 markdown）/ 待确认 / 缺口
```

- [ ] **Step 3: AGENTS.md** — 铁律四条 + 路由到 skill `meeting-to-actions` + 回复四块。

- [ ] **Step 4: smoke.ts**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractActions } from "../lib/extract.ts";
import { composeDraft } from "../lib/compose.ts";
import { confirmActions } from "../lib/confirm.ts";
import { saveActions } from "../lib/save.ts";

const text = readFileSync(path.join(import.meta.dirname, "../data/fixtures/standup-zh.txt"), "utf8");
const extracted = extractActions(text);
const draft = composeDraft(extracted);
const patches = draft.pendingOwnerIds.map((id) => ({ id, owner: "待定-smoke", priority: "P2" as const }));
const batch = confirmActions(extracted, patches);
const saved = saveActions(batch);
console.log("ok", saved.mdPath);
```

- [ ] **Step 5: eval/run-eval.ts** — 读 fixture；断言帮助文档行 owner===null；confirm 补全后 save；二次用脏数据（无 evidence）validate 失败。exit 1 on fail。

- [ ] **Step 6: README** — 黄金路径：`pnpm install`（仓库根）→ `cd examples/meeting-actions-agent && pnpm smoke && pnpm eval && pnpm start`（`--mock`）。

- [ ] **Step 7: Run**

```sh
# 仓库根如需 workspace 链上 example：确认 pnpm-workspace 已含 examples/*
cd /Users/hongchaoling/Desktop/AgentHarness
pnpm install
cd examples/meeting-actions-agent
pnpm test && pnpm smoke && pnpm eval && pnpm typecheck
```

Expected: all pass；`out/actions/` 有文件。

若 workspace 未包含该包，`package.json` 仍用 `workspace:*`；根 `pnpm-workspace.yaml` 已有 `examples/*` 则无需改。

- [ ] **Step 8: Optional getting-started 一句**

在「进阶样板」处加：`examples/meeting-actions-agent`（纪要→行动项）。

- [ ] **Step 9: Commit**

```bash
git add examples/meeting-actions-agent docs/guide/getting-started.md
git commit -m "$(cat <<'EOF'
feat(examples): meeting-actions 约定式专家样板

EOF
)"
```

- [ ] **Step 10: Mark spec ✅** — 改 `docs/superpowers/specs/2026-11-24-meeting-actions-agent-design.md` 状态为已实现；短 commit `docs: meeting-actions 已实现说明`。

---

## Order

Task 1 → 2 → 3 → 4

## Spec coverage

| Spec | Task |
| --- | --- |
| 目录 / 项目壳 | 1, 4 |
| schema / 无证据 | 1 |
| extract / compose | 2 |
| confirm / save 门禁 | 3 |
| tools / skill / AGENTS / smoke / eval / README | 4 |
| 不改 packages/* | 全局 |
| ask_user 仅内置 | 4（skill 引用，不实现同名 tool） |
