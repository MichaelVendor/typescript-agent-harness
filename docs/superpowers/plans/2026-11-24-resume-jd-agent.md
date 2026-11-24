# Resume × JD Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建约定式样板 `examples/resume-jd-agent`：简历+JD → 匹配表 → `ask_user` 是否改写 →（可选）有证据改写 → 落盘；smoke/eval 可无真模型验收。

**Architecture:** 逻辑在 `lib/`（schema、parse、match、rewrite、render、save）；`tools/*.ts` 仅 `defineTool` 薄包装。smoke/eval 直接调 `lib/`。对齐 `examples/weekly-report-agent`（含 save 校验、工具不暴露 `outDir`、eval 防编造）。

**Tech Stack:** TypeScript、`@typescript-agent-harness/cli` `defineTool`、`node --test`、`node --experimental-strip-types`。

**Spec:** `docs/superpowers/specs/2026-11-24-resume-jd-agent-design.md`

## Global Constraints

- 不改 `packages/*` Runtime / DefaultLoop / ask_user 实现
- 仅新增 `examples/resume-jd-agent/**`；可选一句 getting-started 链接
- 禁止编造经历/技能/数字；`missing` 且无 evidence → 只进 gaps，不进 rewrites
- `save_report` 拒绝未选定 `includeRewrites` 的批次；落盘前 `validateMatchResult`
- 工具名不用 `ask_user`；`save-report` 工具 schema **不**暴露 `outDir`
- Conventional Commits；不 push（除非用户另说）

## File map

| File | Role |
| --- | --- |
| `examples/resume-jd-agent/lib/schema.ts` | 类型 + validate |
| `examples/resume-jd-agent/lib/parse.ts` | 拆简历 bullets / JD requirements |
| `examples/resume-jd-agent/lib/match.ts` | 对齐 status + evidence |
| `examples/resume-jd-agent/lib/rewrite.ts` | 有证据改写 |
| `examples/resume-jd-agent/lib/render.ts` | 匹配表 / 改写 Markdown |
| `examples/resume-jd-agent/lib/save.ts` | 落盘 + includeRewrites 门禁 + validate |
| `examples/resume-jd-agent/lib/*.test.ts` | 单测 |
| `examples/resume-jd-agent/tools/*.ts` | defineTool 包装 |
| `examples/resume-jd-agent/skills/resume-jd-match/SKILL.md` | 流程 |
| `examples/resume-jd-agent/data/fixtures/*` | 虚构中文简历 + JD |
| `examples/resume-jd-agent/scripts/smoke.ts` | 无模型冒烟 |
| `examples/resume-jd-agent/eval/run-eval.ts` | 黄金路径 |
| `AGENTS.md` / `README.md` / `package.json` / `tah.config.json` / `tsconfig.json` | 项目壳 |

---

### Task 1: Scaffold + schema + fixture

**Files:**
- Create: `examples/resume-jd-agent/package.json`
- Create: `examples/resume-jd-agent/tsconfig.json`
- Create: `examples/resume-jd-agent/tah.config.json`
- Create: `examples/resume-jd-agent/lib/schema.ts`
- Create: `examples/resume-jd-agent/lib/schema.test.ts`
- Create: `examples/resume-jd-agent/data/fixtures/pair-zh.txt`
- Create: `examples/resume-jd-agent/.gitignore`（`node_modules`、`.env`、`.tah`、`out`）

**Interfaces:**
- Produces: `Priority`, `MatchStatus`, `JdRequirement`, `ParseResult`, `MatchRow`, `MatchResult`, `RewriteItem`, `RewriteResult`, `MatchBatch`, `validateMatchResult(result): string[]`

- [ ] **Step 1: Write failing schema test**

```ts
// lib/schema.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateMatchResult } from "./schema.ts";

test("rejects met/partial row without evidence", () => {
  const problems = validateMatchResult({
    rows: [{
      id: "r1", priority: "must", requirement: "TypeScript",
      status: "met", evidence: "",
    }],
    gaps: [],
  });
  assert.ok(problems.some((p) => /evidence/i.test(p)));
});

test("accepts missing with null evidence", () => {
  const problems = validateMatchResult({
    rows: [{
      id: "r1", priority: "must", requirement: "Kubernetes",
      status: "missing", evidence: null,
    }],
    gaps: ["r1 未覆盖"],
  });
  assert.equal(problems.length, 0);
});

test("rejects invalid status", () => {
  const bad = {
    rows: [{
      id: "r1", priority: "must" as const, requirement: "x",
      status: "ok" as "met", evidence: "e",
    }],
    gaps: [],
  };
  assert.ok(validateMatchResult(bad).some((p) => /status/i.test(p)));
});
```

- [ ] **Step 2: Run test — expect FAIL**

```sh
cd examples/resume-jd-agent && node --test --experimental-strip-types lib/schema.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement schema + scaffold**

`lib/schema.ts`:

```ts
export type Priority = "must" | "nice";
export type MatchStatus = "met" | "partial" | "missing";

export type JdRequirement = {
  id: string;
  text: string;
  priority: Priority;
};

export type ParseResult = {
  resumeBullets: string[];
  jdRequirements: JdRequirement[];
};

export type MatchRow = {
  id: string;
  priority: Priority;
  requirement: string;
  status: MatchStatus;
  evidence: string | null;
};

export type MatchResult = {
  rows: MatchRow[];
  gaps: string[];
};

export type RewriteItem = {
  reqId: string;
  before: string;
  after: string;
  evidence: string;
};

export type RewriteResult = {
  rewrites: RewriteItem[];
};

export type MatchBatch = MatchResult & {
  includeRewrites: boolean;
  rewrites?: RewriteItem[];
};

const VALID_PRIORITY = new Set<Priority>(["must", "nice"]);
const VALID_STATUS = new Set<MatchStatus>(["met", "partial", "missing"]);

export function validateMatchResult(result: MatchResult): string[] {
  const problems: string[] = [];
  for (const row of result.rows) {
    if (!VALID_PRIORITY.has(row.priority)) {
      problems.push(`row ${row.id}: invalid priority "${row.priority}"`);
    }
    if (!VALID_STATUS.has(row.status)) {
      problems.push(`row ${row.id}: invalid status "${row.status}"`);
    }
    if (row.status === "missing") {
      if (row.evidence != null && String(row.evidence).trim() === "") {
        problems.push(`row ${row.id}: evidence must be null or non-empty`);
      }
      // missing + null evidence OK
    } else {
      if (!row.evidence || String(row.evidence).trim() === "") {
        problems.push(`row ${row.id}: evidence is required for ${row.status}`);
      }
    }
  }
  return problems;
}
```

`package.json`:

```json
{
  "name": "@typescript-agent-harness/example-resume-jd-agent",
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

`tsconfig.json` — extends `../../tsconfig.base.json`，include `tools/**/*.ts`、`lib/**/*.ts`。

`tah.config.json`: `{ "capabilities": { "coding": true } }`

Fixture `data/fixtures/pair-zh.txt`（虚构；用清晰分隔符）：

```text
===简历===
- 3 年 TypeScript / Node.js 后端开发
- 主导过支付灰度上线，错误率 <0.1%
- 熟悉 PostgreSQL 与 Redis
- 带过 2 人小组做周报自动化

===JD===
【必须】精通 TypeScript
【必须】有分布式系统或支付相关经验
【必须】Kubernetes 生产运维经验
【加分】带队或 mentorship 经验
【加分】熟悉 Go
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
cd examples/resume-jd-agent && node --test --experimental-strip-types lib/schema.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add examples/resume-jd-agent
git commit -m "$(cat <<'EOF'
feat(examples): resume-jd scaffold 与 schema

EOF
)"
```

---

### Task 2: parse + match (lib) TDD

**Files:**
- Create: `lib/parse.ts`, `lib/parse.test.ts`
- Create: `lib/match.ts`, `lib/match.test.ts`

**Interfaces:**
- Produces:
  - `parsePair(text: string): ParseResult`
  - `matchRequirements(parsed: ParseResult): MatchResult`

- [ ] **Step 1: Failing parse + match tests**

```ts
// lib/parse.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parsePair } from "./parse.ts";

const fixture = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/pair-zh.txt"),
  "utf8",
);

test("parsePair splits resume bullets and jd must/nice", () => {
  const p = parsePair(fixture);
  assert.ok(p.resumeBullets.some((b) => /TypeScript/.test(b)));
  assert.ok(p.jdRequirements.some((r) => r.priority === "must" && /TypeScript/.test(r.text)));
  assert.ok(p.jdRequirements.some((r) => r.priority === "must" && /Kubernetes/.test(r.text)));
  assert.ok(p.jdRequirements.some((r) => r.priority === "nice" && /Go/.test(r.text)));
  assert.ok(p.jdRequirements.every((r) => /^r\d+$/.test(r.id)));
});
```

```ts
// lib/match.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parsePair } from "./parse.ts";
import { matchRequirements } from "./match.ts";
import { validateMatchResult } from "./schema.ts";

const fixture = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/pair-zh.txt"),
  "utf8",
);

test("fixture: met/partial/missing; no invented evidence", () => {
  const m = matchRequirements(parsePair(fixture));
  assert.equal(validateMatchResult(m).length, 0);
  const ts = m.rows.find((r) => /TypeScript/.test(r.requirement));
  assert.ok(ts);
  assert.equal(ts!.status, "met");
  assert.match(ts!.evidence!, /TypeScript/);
  const k8s = m.rows.find((r) => /Kubernetes/.test(r.requirement));
  assert.ok(k8s);
  assert.equal(k8s!.status, "missing");
  assert.equal(k8s!.evidence, null);
  assert.ok(m.gaps.some((g) => /Kubernetes|未覆盖/.test(g)));
  const pay = m.rows.find((r) => /支付|分布式/.test(r.requirement));
  assert.ok(pay);
  assert.ok(pay!.status === "met" || pay!.status === "partial");
  assert.ok(pay!.evidence && /支付|灰度/.test(pay!.evidence));
  assert.ok(!m.rows.some((r) => /Docker Swarm|AWS Lambda/i.test(r.evidence ?? "")));
});
```

实现策略（确定性，YAGNI）：
- `parsePair`：按 `===简历===` / `===JD===` 分段；简历取 `- ` 行；JD 行 `【必须】`→must、`【加分】`→nice；id=`r1`…
- `matchRequirements`：对每个 requirement 抽关键词（去停用词后的汉字/英文 token）；在 bullets 中找包含最多 token 的行：
  - 全命中关键 token → `met`，evidence=该 bullet
  - 部分命中 → `partial`，evidence=最佳 bullet
  - 零命中 → `missing`，evidence=`null`，gaps 追加

- [ ] **Step 2: FAIL → implement → PASS**

```sh
cd examples/resume-jd-agent && node --test --experimental-strip-types lib/parse.test.ts lib/match.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add examples/resume-jd-agent/lib
git commit -m "$(cat <<'EOF'
feat(examples): resume-jd parse/match

EOF
)"
```

---

### Task 3: rewrite + render + save gate TDD

**Files:**
- Create: `lib/rewrite.ts`, `lib/rewrite.test.ts`
- Create: `lib/render.ts`, `lib/render.test.ts`
- Create: `lib/save.ts`, `lib/save.test.ts`

**Interfaces:**

```ts
export function composeRewrites(match: MatchResult): RewriteResult;

export function renderMatchReport(
  match: MatchResult,
  rewrites: RewriteItem[] | null,
): { markdown: string };

export function selectIncludeRewrites(
  match: MatchResult,
  includeRewrites: boolean,
  rewrites?: RewriteItem[],
): MatchBatch;

export function saveReport(
  batch: MatchBatch,
  opts?: { outDir?: string; now?: Date },
): { mdPath: string; jsonPath: string };
```

规则：
- `composeRewrites`：只处理 `status !== "met" && evidence != null`；`before`=evidence；`after`=在 before 上点出 requirement 关键词的改写句（**不得引入 evidence/简历外的专有名词**）；`missing`+null → 跳过
- `saveReport`：
  1. 若 `includeRewrites` 不是 boolean → throw `"includeRewrites required"`
  2. `validateMatchResult(batch)` 有问题 → throw `"validation failed: …"`
  3. 若 `includeRewrites===true` 且未提供 `rewrites`，内部可调用 `composeRewrites`；若 `false`，忽略/清空 rewrites
  4. 写出 `out/match/<ts>.{md,json}`；工具层不暴露 `outDir`

- [ ] **Step 1: Tests**

```ts
// lib/rewrite.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { composeRewrites } from "./rewrite.ts";

test("skips missing without evidence; rewrites partial with evidence", () => {
  const { rewrites } = composeRewrites({
    rows: [
      { id: "r1", priority: "must", requirement: "Kubernetes", status: "missing", evidence: null },
      {
        id: "r2", priority: "nice", requirement: "带队经验",
        status: "partial", evidence: "带过 2 人小组做周报自动化",
      },
    ],
    gaps: ["r1 未覆盖"],
  });
  assert.ok(!rewrites.some((x) => x.reqId === "r1"));
  const r2 = rewrites.find((x) => x.reqId === "r2");
  assert.ok(r2);
  assert.equal(r2!.before, "带过 2 人小组做周报自动化");
  assert.match(r2!.after, /带|小组|周报/);
  assert.doesNotMatch(r2!.after, /Kubernetes|Go 语言/);
});
```

```ts
// lib/render.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { renderMatchReport } from "./render.ts";

test("render includes table and optional rewrites section", () => {
  const { markdown } = renderMatchReport(
    {
      rows: [
        { id: "r1", priority: "must", requirement: "TS", status: "met", evidence: "3 年 TypeScript" },
        { id: "r2", priority: "must", requirement: "K8s", status: "missing", evidence: null },
      ],
      gaps: ["r2 未覆盖"],
    },
    [{ reqId: "r2", before: "x", after: "y", evidence: "x" }],
  );
  assert.match(markdown, /匹配表|requirement|必须|TS/i);
  assert.match(markdown, /改写|r2/);
  assert.match(markdown, /缺口|未覆盖/);
});
```

```ts
// lib/save.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveReport, selectIncludeRewrites } from "./save.ts";

const base = {
  rows: [
    { id: "r1", priority: "must" as const, requirement: "TS", status: "met" as const, evidence: "3 年 TypeScript" },
  ],
  gaps: [],
};

test("save rejects missing includeRewrites", () => {
  assert.throws(
    () => saveReport({ ...base, includeRewrites: undefined as unknown as boolean }),
    /includeRewrites/i,
  );
});

test("save rejects invalid match (empty evidence on met)", () => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "resume-jd-"));
  try {
    assert.throws(() =>
      saveReport({
        includeRewrites: false,
        gaps: [],
        rows: [{ id: "r1", priority: "must", requirement: "x", status: "met", evidence: "" }],
      }, { outDir }),
    );
    assert.equal(existsSync(path.join(outDir, "match")), false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("selectIncludeRewrites + save writes md/json", () => {
  const batch = selectIncludeRewrites(base, false);
  const outDir = mkdtempSync(path.join(os.tmpdir(), "resume-jd-"));
  try {
    const saved = saveReport(batch, { outDir });
    assert.match(saved.mdPath, /match/);
    assert.ok(readFileSync(saved.mdPath, "utf8").length > 0);
    assert.ok(readFileSync(saved.jsonPath, "utf8").includes("r1"));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Implement — tests PASS**

```sh
cd examples/resume-jd-agent && node --test --experimental-strip-types lib/rewrite.test.ts lib/render.test.ts lib/save.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add examples/resume-jd-agent/lib
git commit -m "$(cat <<'EOF'
feat(examples): resume-jd rewrite/render/save 门禁

EOF
)"
```

---

### Task 4: tools + skill + AGENTS + smoke/eval + README

**Files:**
- Create: `tools/parse-pair.ts`, `match-requirements.ts`, `compose-rewrites.ts`, `save-report.ts`
- Create: `skills/resume-jd-match/SKILL.md`
- Create: `AGENTS.md`, `README.md`
- Create: `scripts/smoke.ts`, `eval/run-eval.ts`
- Modify (optional): `docs/guide/getting-started.md` — 进阶样板追加 resume-jd
- Modify: `docs/superpowers/specs/2026-11-24-resume-jd-agent-design.md` — 状态 ✅ 已实现

**Interfaces:** tools 只调 lib；工具名 `parse_pair` / `match_requirements` / `compose_rewrites` / `save_report`。

- [ ] **Step 1: tools**

`save-report.ts` 入参仅 `{ match, includeRewrites, rewrites? }`——**无 outDir**。内部 `selectIncludeRewrites` + `saveReport`。

`parse-pair` / `match-requirements` 返回 `{ result, problems }`（match 路径跑 validate）。

- [ ] **Step 2: skill + AGENTS + README**

Skill 顺序：`parse_pair` → `match_requirements` → `ask_user` yes/no →（yes 则 `compose_rewrites`）→ `save_report` → 四块回复。

AGENTS 铁律四条；中文。

- [ ] **Step 3: smoke + eval**

`scripts/smoke.ts`：parse→match→composeRewrites→selectIncludeRewrites(true, rewrites)→saveReport；打印 `ok …mdPath`。

`eval/run-eval.ts`：
1. fixture match 通过 validate；含 must + nice；Kubernetes missing + null evidence
2. composeRewrites 不含 Kubernetes 行
3. 每个 met/partial 的 evidence 是某条 resume bullet（trim 后精确或子串来自 fixture 简历段）
4. 无 includeRewrites 的 save 抛错；注入 false/true 后 md/json 存在
5. 脏数据：met + 空 evidence 被 validate / save 拒绝

- [ ] **Step 4: install + verify**

```sh
cd /Users/hongchaoling/Desktop/AgentHarness && pnpm install
cd examples/resume-jd-agent && pnpm test && pnpm smoke && pnpm eval && pnpm typecheck
```

Expected: tests PASS；smoke `ok …/out/match/…`；eval `eval ok`；typecheck 0 errors。

- [ ] **Step 5: optional getting-started + spec status**

- [ ] **Step 6: Commits**

```bash
git add examples/resume-jd-agent docs/guide/getting-started.md pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(examples): resume-jd 约定式专家样板

EOF
)"

git add docs/superpowers/specs/2026-11-24-resume-jd-agent-design.md
git commit -m "$(cat <<'EOF'
docs: resume-jd 已实现说明

EOF
)"
```

---

## Self-review (plan author)

1. **Spec coverage:** 目标/非目标/目录/铁律/流程/schema/工具/smoke·eval·test/outDir 禁令 → Tasks 1–4 覆盖。
2. **Placeholders:** 无 TBD；match 关键词策略已写死。
3. **Types:** ParseResult / MatchResult / RewriteResult / MatchBatch / includeRewrites 前后一致；与 weekly-report 学到的 save 校验一致。
