# Weekly Report Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建约定式样板 `examples/weekly-report-agent`：杂记 → 归类 → `ask_user` 选模板 → 渲染落盘；smoke/eval 可无真模型验收。

**Architecture:** 逻辑在 `lib/`（schema、extract、compose、render、save）；`tools/*.ts` 仅 `defineTool` 薄包装。smoke/eval 直接调 `lib/`，不经 LLM。对齐 `examples/meeting-actions-agent`。

**Tech Stack:** TypeScript、`@typescript-agent-harness/cli` `defineTool`、`node --test`、`node --experimental-strip-types`。

**Spec:** `docs/superpowers/specs/2026-11-24-weekly-report-agent-design.md`

## Global Constraints

- 不改 `packages/*` Runtime / DefaultLoop / ask_user 实现
- 仅新增 `examples/weekly-report-agent/**`；可选一句 getting-started 链接
- 禁止编造原文未出现的事项 / 数字 / 人名；`unclassified` 进 gaps，不进正文主表
- `save_report` 拒绝未选定 `template`（`ops` | `exec`）的批次
- 工具名不用保留名 `ask_user`
- Conventional Commits；不 push（除非用户另说）

## File map

| File | Role |
| --- | --- |
| `examples/weekly-report-agent/lib/schema.ts` | 类型 + validate |
| `examples/weekly-report-agent/lib/extract.ts` | 规则归类（fixture 确定性） |
| `examples/weekly-report-agent/lib/compose.ts` | 待选模板前草稿 Markdown |
| `examples/weekly-report-agent/lib/render.ts` | ops / exec 定稿 Markdown |
| `examples/weekly-report-agent/lib/save.ts` | 落盘 + template 门禁 |
| `examples/weekly-report-agent/lib/*.test.ts` | 单测 |
| `examples/weekly-report-agent/tools/*.ts` | defineTool 包装 |
| `examples/weekly-report-agent/skills/notes-to-weekly/SKILL.md` | 流程 |
| `examples/weekly-report-agent/data/fixtures/*.txt` | 虚构中文杂记 |
| `examples/weekly-report-agent/scripts/smoke.ts` | 无模型冒烟 |
| `examples/weekly-report-agent/eval/run-eval.ts` | 黄金路径 |
| `AGENTS.md` / `README.md` / `package.json` / `tah.config.json` / `tsconfig.json` | 项目壳 |

---

### Task 1: Scaffold + schema + fixture

**Files:**
- Create: `examples/weekly-report-agent/package.json`
- Create: `examples/weekly-report-agent/tsconfig.json`
- Create: `examples/weekly-report-agent/tah.config.json`
- Create: `examples/weekly-report-agent/lib/schema.ts`
- Create: `examples/weekly-report-agent/lib/schema.test.ts`
- Create: `examples/weekly-report-agent/data/fixtures/notes-zh.txt`
- Create: `examples/weekly-report-agent/.gitignore`（`node_modules`、`.env`、`.tah`、`out`）

**Interfaces:**
- Produces: `ItemSection`, `ReportItem`, `ExtractResult`, `ReportTemplate`, `ReportBatch`, `validateExtractResult(result): string[]`

- [ ] **Step 1: Write failing schema test**

```ts
// lib/schema.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateExtractResult } from "./schema.ts";

test("rejects item without evidence", () => {
  const problems = validateExtractResult({
    items: [{
      id: "i1", section: "done", text: "上线支付灰度", evidence: "",
    }],
    gaps: [],
  });
  assert.ok(problems.some((p) => /evidence/i.test(p)));
});

test("accepts unclassified with gap", () => {
  const problems = validateExtractResult({
    items: [{
      id: "i1", section: "unclassified", text: "随便记一下",
      evidence: "随便记一下",
    }],
    gaps: ["i1 无法归类"],
  });
  assert.equal(problems.length, 0);
});

test("rejects invalid section", () => {
  const problems = validateExtractResult({
    items: [{
      id: "i1", section: "done" as const, text: "x", evidence: "x",
    }],
    gaps: [],
  });
  // mutate to invalid at runtime
  const bad = {
    items: [{ id: "i1", section: "later" as "done", text: "x", evidence: "x" }],
    gaps: [],
  };
  assert.ok(validateExtractResult(bad).some((p) => /section/i.test(p)));
});
```

- [ ] **Step 2: Run test — expect FAIL**

```sh
cd examples/weekly-report-agent && node --test --experimental-strip-types lib/schema.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement schema + scaffold**

`lib/schema.ts`:

```ts
export type ItemSection = "done" | "wip" | "risk" | "next" | "unclassified";
export type ReportTemplate = "ops" | "exec";

export type ReportItem = {
  id: string;
  section: ItemSection;
  text: string;
  evidence: string;
};

export type ExtractResult = {
  periodHint?: string;
  items: ReportItem[];
  gaps: string[];
};

export type ReportBatch = ExtractResult & {
  template: ReportTemplate;
};

const VALID_SECTIONS = new Set<ItemSection>([
  "done", "wip", "risk", "next", "unclassified",
]);

export function validateExtractResult(result: ExtractResult): string[] {
  const problems: string[] = [];
  for (const item of result.items) {
    if (!VALID_SECTIONS.has(item.section)) {
      problems.push(`item ${item.id}: invalid section "${item.section}"`);
    }
    if (!item.evidence || item.evidence.trim() === "") {
      problems.push(`item ${item.id}: evidence is required`);
    }
  }
  return problems;
}
```

`package.json`:

```json
{
  "name": "@typescript-agent-harness/example-weekly-report-agent",
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

`tsconfig.json` — 同 meeting-actions（extends `../../tsconfig.base.json`，include `tools/**/*.ts`、`lib/**/*.ts`）。

`tah.config.json`: `{ "capabilities": { "coding": true } }`

Fixture `data/fixtures/notes-zh.txt`（虚构，覆盖四段 + 一条无法归类）：

```text
本周杂记（11/18–11/24）
- 完成：支付灰度周一已上线，错误率 <0.1%
- 还在改登录页重构，预计周五提测
- 风险：帮助文档没人更新，客服在催
- 下周：补齐支付监控看板
天气不错，中午吃了拉面
```

`.gitignore`:

```
node_modules/
.env
.tah/
out/
```

- [ ] **Step 4: Tests pass**

```sh
cd examples/weekly-report-agent && node --test --experimental-strip-types lib/schema.test.ts
```

Expected: PASS（2–3 tests）

- [ ] **Step 5: Commit**

```bash
git add examples/weekly-report-agent
git commit -m "$(cat <<'EOF'
feat(examples): weekly-report scaffold 与 schema

EOF
)"
```

---

### Task 2: extract + compose (lib) TDD

**Files:**
- Create: `lib/extract.ts`, `lib/extract.test.ts`
- Create: `lib/compose.ts`, `lib/compose.test.ts`

**Interfaces:**
- Consumes: `ExtractResult` / `ReportItem`
- Produces:
  - `extractItems(text: string): ExtractResult`
  - `composeDraft(result: ExtractResult): { markdown: string; unclassifiedIds: string[] }`

- [ ] **Step 1: Failing extract test against fixture**

```ts
// lib/extract.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractItems } from "./extract.ts";
import { validateExtractResult } from "./schema.ts";

const fixture = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/notes-zh.txt"),
  "utf8",
);

test("fixture: sections + unclassified; no invented items", () => {
  const r = extractItems(fixture);
  assert.equal(validateExtractResult(r).length, 0);
  assert.match(r.periodHint ?? "", /11\/18|11-18|本周/);
  const done = r.items.find((x) => x.section === "done" && /支付灰度/.test(x.text));
  assert.ok(done);
  assert.match(done!.evidence, /支付灰度/);
  assert.ok(r.items.some((x) => x.section === "wip" && /登录页/.test(x.text)));
  assert.ok(r.items.some((x) => x.section === "risk" && /帮助文档/.test(x.text)));
  assert.ok(r.items.some((x) => x.section === "next" && /监控看板/.test(x.text)));
  const food = r.items.find((x) => /拉面/.test(x.text));
  assert.ok(food);
  assert.equal(food!.section, "unclassified");
  assert.ok(r.gaps.some((g) => /拉面|无法归类|unclassified/i.test(g)));
  // 不得编造原文没有的产品名
  assert.ok(!r.items.some((x) => /日历|Slack|Jira/i.test(x.text)));
});
```

实现策略（确定性规则，YAGNI）：
- 按非空行扫描；跳过纯标题行若无可归类关键词。
- 行内/行首关键词：`完成`/`已上线`/`done` → `done`；`还在`/`进行中`/`wip`/`改`（且无完成词）→ `wip`；`风险`/`阻塞`/`催` → `risk`；`下周`/`next` → `next`。
- `本周杂记（…）` / 日期范围 → `periodHint`。
- 无关键词命中 → `unclassified`，gaps 记一条。
- 每条 `evidence` = 原行 trim；`id` = `i1`…；`text` = 去掉前缀标签后的短句（可保留整行）。

- [ ] **Step 2: Run extract test — FAIL then implement — PASS**

```sh
cd examples/weekly-report-agent && node --test --experimental-strip-types lib/extract.test.ts
```

- [ ] **Step 3: compose test**

```ts
// lib/compose.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { composeDraft } from "./compose.ts";

test("compose lists sections and unclassified ids", () => {
  const { markdown, unclassifiedIds } = composeDraft({
    periodHint: "11/18–11/24",
    items: [
      { id: "i1", section: "done", text: "支付灰度上线", evidence: "…" },
      { id: "i2", section: "unclassified", text: "中午吃了拉面", evidence: "…" },
    ],
    gaps: ["i2 无法归类"],
  });
  assert.deepEqual(unclassifiedIds, ["i2"]);
  assert.match(markdown, /待选模板|ops|exec/);
  assert.match(markdown, /支付灰度/);
  assert.match(markdown, /缺口|无法归类|拉面/);
});
```

`composeDraft` 输出含 period、按 section 分组列表、缺口、提示下一步用 `ask_user` 选 `ops`/`exec`。

- [ ] **Step 4: Commit**

```bash
git add examples/weekly-report-agent/lib
git commit -m "$(cat <<'EOF'
feat(examples): weekly-report extract/compose

EOF
)"
```

---

### Task 3: render + save gate TDD

**Files:**
- Create: `lib/render.ts`, `lib/render.test.ts`
- Create: `lib/save.ts`, `lib/save.test.ts`

**Interfaces:**

```ts
export function renderReport(
  result: ExtractResult,
  template: ReportTemplate,
): { markdown: string; template: ReportTemplate };

export function selectTemplate(
  result: ExtractResult,
  template: ReportTemplate,
): ReportBatch;

export function saveReport(
  batch: ReportBatch,
  opts?: { outDir?: string },
): { mdPath: string; jsonPath: string };
```

门禁：
1. `saveReport`：若缺少合法 `template` → throw `"template required"`
2. 写出 `out/reports/<ts>.md` + `.json`（`ts` = ISO 安全文件名）
3. `renderReport`：
   - `ops`：四段 `## 完成|进行中|风险|下周`，只列对应 section；`unclassified` 不进主表，附录 `## 缺口`
   - `exec`：`## 摘要` 从 done/wip/risk 各取至多 2 条合成要点（总数 3–5，不足则有几条列几条，**不新增**）；`## 下周` 只列 `next`；附录缺口

- [ ] **Step 1: Tests**

```ts
// lib/render.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "./render.ts";
import type { ExtractResult } from "./schema.ts";

const sample: ExtractResult = {
  periodHint: "W47",
  items: [
    { id: "i1", section: "done", text: "灰度上线", evidence: "e1" },
    { id: "i2", section: "wip", text: "登录重构", evidence: "e2" },
    { id: "i3", section: "risk", text: "文档无人更新", evidence: "e3" },
    { id: "i4", section: "next", text: "监控看板", evidence: "e4" },
    { id: "i5", section: "unclassified", text: "拉面", evidence: "e5" },
  ],
  gaps: ["i5 无法归类"],
};

test("ops has four sections and excludes unclassified from main", () => {
  const { markdown } = renderReport(sample, "ops");
  assert.match(markdown, /## 完成/);
  assert.match(markdown, /## 进行中/);
  assert.match(markdown, /## 风险/);
  assert.match(markdown, /## 下周/);
  assert.match(markdown, /灰度上线/);
  assert.match(markdown, /## 缺口/);
  // unclassified 可出现在缺口，但不应作为主表 bullet 冒充完成项
  const main = markdown.split("## 缺口")[0]!;
  assert.doesNotMatch(main, /拉面/);
});

test("exec is one-pager without inventing items", () => {
  const { markdown } = renderReport(sample, "exec");
  assert.match(markdown, /## 摘要/);
  assert.match(markdown, /## 下周/);
  assert.match(markdown, /监控看板/);
  assert.doesNotMatch(markdown, /日历|Jira/);
});
```

```ts
// lib/save.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveReport, selectTemplate } from "./save.ts";
import { renderReport } from "./render.ts";

const base = {
  items: [
    { id: "i1", section: "done" as const, text: "x", evidence: "e" },
  ],
  gaps: [],
};

test("save rejects missing template", () => {
  assert.throws(
    () => saveReport({ ...base, template: undefined as unknown as "ops" }),
    /template/i,
  );
});

test("selectTemplate + save writes md/json", () => {
  const batch = selectTemplate(base, "ops");
  assert.equal(batch.template, "ops");
  const outDir = mkdtempSync(path.join(os.tmpdir(), "weekly-report-"));
  try {
    const { markdown } = renderReport(batch, batch.template);
    const saved = saveReport({ ...batch, /* persist markdown via save */ }, { outDir });
    // saveReport 内部应自行 render，或接受已渲染内容——采用内部调用 renderReport
    assert.match(saved.mdPath, /reports/);
    assert.match(readFileSync(saved.mdPath, "utf8"), /完成|摘要|x/);
    assert.ok(readFileSync(saved.jsonPath, "utf8").includes("i1"));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
```

**澄清（实现约定）：** `saveReport(batch, opts)` **内部**调用 `renderReport(batch, batch.template)` 再写盘；`selectTemplate` 仅打标 `template`，可放在 `save.ts` 或独立 `select.ts`——**采用放在 `save.ts` 一并导出**，减少文件。

- [ ] **Step 2: Implement render.ts + save.ts — tests PASS**

```sh
cd examples/weekly-report-agent && node --test --experimental-strip-types lib/render.test.ts lib/save.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add examples/weekly-report-agent/lib
git commit -m "$(cat <<'EOF'
feat(examples): weekly-report render/save 门禁

EOF
)"
```

---

### Task 4: tools + skill + AGENTS + smoke/eval + README

**Files:**
- Create: `tools/extract-items.ts`, `compose-draft.ts`, `render-report.ts`, `save-report.ts`
- Create: `skills/notes-to-weekly/SKILL.md`
- Create: `AGENTS.md`, `README.md`
- Create: `scripts/smoke.ts`, `eval/run-eval.ts`
- Modify (optional): `docs/guide/getting-started.md` — 进阶样板链追加 weekly-report

**Interfaces:** tools 只调 lib；文件名 → 工具名 `extract_items` / `compose_draft` / `render_report` / `save_report`。

- [ ] **Step 1: tools**

每个工具同 meeting-actions 模式，例如：

```ts
// tools/extract-items.ts
import { defineTool } from "@typescript-agent-harness/cli";
import { extractItems } from "../lib/extract.ts";
import { validateExtractResult } from "../lib/schema.ts";

export default defineTool({
  description: "从周报杂记原文抽取并归类条目（done/wip/risk/next）；无法归类进 gaps。",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  async execute(input: { text?: string }) {
    const result = extractItems(String(input.text ?? ""));
    return { result, problems: validateExtractResult(result) };
  },
});
```

`compose-draft.ts` → `composeDraft`；`render-report.ts` 入参 `{ result, template }`；`save-report.ts` 入参 `{ result, template, outDir? }`，内部 `selectTemplate` + `saveReport`。

- [ ] **Step 2: skill + AGENTS + README**

`skills/notes-to-weekly/SKILL.md` 写死顺序：

1. `extract_items`
2. `compose_draft`
3. 内置 `ask_user`：选 `ops` 或 `exec`
4. `render_report`
5. `save_report`
6. 回复三块：摘要 · 正文（工具 md）· 缺口

`AGENTS.md`：路由到本 skill；铁律四条（与 spec 一致）；中文回答。

`README.md`：黄金路径、`pnpm smoke` / `eval` / `test`、铁律摘要。

- [ ] **Step 3: smoke + eval**

`scripts/smoke.ts`：

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractItems } from "../lib/extract.ts";
import { composeDraft } from "../lib/compose.ts";
import { selectTemplate, saveReport } from "../lib/save.ts";

const text = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/notes-zh.txt"),
  "utf8",
);
const extracted = extractItems(text);
composeDraft(extracted); // 预览侧效应：无
const batch = selectTemplate(extracted, "ops");
const saved = saveReport(batch);
console.log("ok", saved.mdPath);
```

`eval/run-eval.ts` 断言：
1. fixture extract 通过 validate；含 done/wip/risk/next/unclassified
2. 不出现 fixture 外关键词（如 `Jira`）
3. `renderReport(..., "ops")` 主表无「拉面」；`exec` 含「下周」
4. 无 template 的 save 抛错；注入 `ops` 后 md/json 存在
5. 空 evidence 的脏数据被 validate 拒绝

- [ ] **Step 4: install + verify**

```sh
cd /Users/hongchaoling/Desktop/AgentHarness && pnpm install
cd examples/weekly-report-agent && pnpm test && pnpm smoke && pnpm eval && pnpm typecheck
```

Expected: tests PASS；smoke 打印 `ok …/out/reports/…`；eval 打印 `eval ok`；typecheck 0 errors。

- [ ] **Step 5: optional getting-started 一句**

在现有进阶样板句追加：`examples/weekly-report-agent`（杂记→周报）。

- [ ] **Step 6: Commit**

```bash
git add examples/weekly-report-agent docs/guide/getting-started.md
git commit -m "$(cat <<'EOF'
feat(examples): weekly-report 约定式专家样板

EOF
)"
```

- [ ] **Step 7: Spec 状态更新（小提交）**

将 `docs/superpowers/specs/2026-11-24-weekly-report-agent-design.md` 状态改为 `✅ 已实现`，后续句同步。

```bash
git add docs/superpowers/specs/2026-11-24-weekly-report-agent-design.md
git commit -m "$(cat <<'EOF'
docs: weekly-report 已实现说明

EOF
)"
```

---

## Self-review (plan author)

1. **Spec coverage:** 目标/非目标/目录/铁律/流程/schema/模板/工具/smoke·eval·test → Tasks 1–4 均覆盖；getting-started 可选已写入 Task 4。
2. **Placeholders:** 无 TBD；save 内部 render 已写死约定。
3. **Types:** `ItemSection` / `ReportItem` / `ExtractResult` / `ReportTemplate` / `ReportBatch` / `extractItems` / `composeDraft` / `renderReport` / `selectTemplate` / `saveReport` 前后一致。
