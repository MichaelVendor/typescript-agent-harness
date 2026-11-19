# brief-agent（竞品简报）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `examples/brief-agent` 落地可跑的竞品简报约定式项目：mock DE 档案 → Skill 约束路径 → 规则 compose/落盘 → 无模型 Eval 5/5。

**Architecture:** 同构 `selection-agent`：纯函数 `lib/` 承载事实与 schema；`tools/` 薄封装 `defineTool`；子 Agent 经 `submit_signals` 交卷；主路径 `resolve → fetch → extract → compose → save`；Eval 程序化调 lib，不启 LLM。

**Tech Stack:** TypeScript、`node:test`、`node --experimental-strip-types`、`@typescript-agent-harness/cli`（workspace）、无 zod。

**Spec:** `docs/superpowers/specs/2026-11-19-brief-agent-design.md`

## Global Constraints

- 不修改 `@typescript-agent-harness/*` 核心包 API
- P0 不做真抓、浏览器、Super-agent、IM、计费、多站点
- 缺字段用 `null` / `"缺数据"`；禁止臆造价格、评论数、排名
- 目标上限 8；子 Agent 失败最多重试 1 次（Eval 路径用假子 Agent，不测 LLM 重试）
- Conventional Commits；不 push；不提交 `out/`、`.env`、`.superpowers/`
- 提交信息用中文描述、英文 type/scope（对齐仓库）

## File map

| File | Responsibility |
| --- | --- |
| `examples/brief-agent/package.json` | scripts：`eval` / `test` / `smoke` / `start` |
| `examples/brief-agent/tsconfig.json` | 对齐 selection-agent |
| `examples/brief-agent/AGENTS.md` | 角色 + 铁律 + 回复格式 |
| `examples/brief-agent/README.md` | 怎么跑 |
| `examples/brief-agent/data/mock-de.json` | 3+ mock 竞品（含缺价格样例） |
| `examples/brief-agent/lib/schema.ts` | Target / Signals / Brief 类型 + 手写校验 |
| `examples/brief-agent/lib/targets.ts` | `resolveTargets`（截断 8） |
| `examples/brief-agent/lib/fetch.ts` | 读 mock；可注入失败 id |
| `examples/brief-agent/lib/signals.ts` | 从档案抽四桶信号（无 LLM） |
| `examples/brief-agent/lib/compose.ts` | 合并 → Brief schema + markdown |
| `examples/brief-agent/lib/save.ts` | 写 `out/briefs/<ts>.{json,md}` |
| `examples/brief-agent/lib/extract.ts` | 有界并发假子 Agent 编排（Eval/smoke） |
| `examples/brief-agent/lib/events.ts` | `BRIEF_SAVED` 常量 |
| `examples/brief-agent/tools/*.ts` | defineTool 薄封装 |
| `examples/brief-agent/skills/competitive-brief/SKILL.md` | 路径约束 |
| `examples/brief-agent/plugins/run-log.ts` | `out/run-log.jsonl` |
| `examples/brief-agent/eval/*` | 5 cases + runner |
| `examples/brief-agent/scripts/smoke.ts` | 无模型冒烟 |

---

### Task 1: 脚手架 + schema

**Files:**
- Create: `examples/brief-agent/package.json`
- Create: `examples/brief-agent/tsconfig.json`
- Create: `examples/brief-agent/lib/schema.ts`
- Create: `examples/brief-agent/lib/schema.test.ts`

**Interfaces:**
- Produces: `Evidence`, `SignalBucket`, `TargetSignals`, `Brief`, `validateBrief`, `MAX_TARGETS = 8`

- [ ] **Step 1: 写失败测试**

```ts
// examples/brief-agent/lib/schema.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateBrief, type Brief } from "./schema.ts";

describe("validateBrief", () => {
  it("rejects invented rank when rank is null", () => {
    const brief: Brief = {
      market: "DE",
      conclusion: "本批可继续观察",
      rows: [
        {
          id: "B0",
          title: "Tray",
          priceEur: null,
          rank: null,
          bullets: ["不锈钢"],
          reviewThemes: ["生锈"],
          changes: [],
          evidence: [
            { claim: "标题含 Edelstahl", source: "mock", detail: "B0" },
            { claim: "差评提到 Rost", source: "mock", detail: "B0" },
            { claim: "无排名数据", source: "mock", detail: "rank=null" },
          ],
        },
      ],
      gaps: ["缺价格"],
      failures: [],
      truncated: false,
      markdown: "x",
    };
    const problems = validateBrief(brief);
    assert.equal(problems.length, 0);
  });

  it("flags markdown that invents a euro price when priceEur is null", () => {
    const brief: Brief = {
      market: "DE",
      conclusion: "观察",
      rows: [
        {
          id: "B0",
          title: "Tray",
          priceEur: null,
          rank: null,
          bullets: [],
          reviewThemes: [],
          changes: [],
          evidence: [
            { claim: "a", source: "m", detail: "1" },
            { claim: "b", source: "m", detail: "2" },
            { claim: "c", source: "m", detail: "3" },
          ],
        },
      ],
      gaps: ["缺价格"],
      failures: [],
      truncated: false,
      markdown: "售价约 €19.99",
    };
    const problems = validateBrief(brief);
    assert.ok(problems.some((p) => p.path === "markdown" && /臆造|缺价格/.test(p.message)));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd examples/brief-agent && node --test --experimental-strip-types lib/schema.test.ts`  
Expected: FAIL（模块不存在或断言未实现）

- [ ] **Step 3: 实现 schema + package 脚手架**

`package.json`:

```json
{
  "name": "@typescript-agent-harness/example-brief-agent",
  "private": true,
  "version": "1.7.4",
  "type": "module",
  "scripts": {
    "start": "tah chat",
    "typecheck": "tsc -p tsconfig.json",
    "smoke": "node --experimental-strip-types scripts/smoke.ts",
    "eval": "node --experimental-strip-types eval/run-eval.ts",
    "test": "node --test --experimental-strip-types \"lib/**/*.test.ts\" \"eval/**/*.test.ts\""
  },
  "devDependencies": {
    "@types/node": "^22.18.0",
    "@typescript-agent-harness/cli": "workspace:*",
    "@typescript-agent-harness/core": "workspace:*",
    "typescript": "^5.9.2"
  }
}
```

`tsconfig.json`：复制 `examples/selection-agent/tsconfig.json`。

`lib/schema.ts` 核心类型与校验（手写，无 zod）：

```ts
export const MAX_TARGETS = 8;

export type Evidence = { claim: string; source: string; detail: string };

export type SignalBucket = {
  pricing: { priceEur: number | null; currency: "EUR"; evidence: Evidence[] };
  positioning: { bullets: string[]; evidence: Evidence[] };
  reviews: { themes: string[]; evidence: Evidence[] };
  changes: { notes: string[]; evidence: Evidence[] };
};

export type TargetSignals = {
  id: string;
  title: string;
  buckets: SignalBucket;
};

export type BriefRow = {
  id: string;
  title: string;
  priceEur: number | null;
  rank: number | null;
  bullets: string[];
  reviewThemes: string[];
  changes: string[];
  evidence: Evidence[];
};

export type Failure = { id: string; stage: string; message: string };

export type Brief = {
  market: "DE";
  conclusion: string;
  rows: BriefRow[];
  gaps: string[];
  failures: Failure[];
  truncated: boolean;
  markdown: string;
};

export type Problem = { path: string; message: string };

const EURO_PRICE = /€\s*\d|\d+[.,]\d{2}\s*€/;

export function validateBrief(brief: Brief): Problem[] {
  const problems: Problem[] = [];
  for (const row of brief.rows) {
    if (row.evidence.length < 3) {
      problems.push({ path: `rows.${row.id}.evidence`, message: "每竞品至少 3 条 evidence" });
    }
    if (row.priceEur === null && EURO_PRICE.test(brief.markdown) && brief.markdown.includes(row.title)) {
      problems.push({ path: "markdown", message: "缺价格时禁止臆造欧元价" });
    }
    if (row.rank === null && /第\s*\d+\s*名|\bBSR\b|\b#\d+/i.test(brief.markdown) && brief.markdown.includes(row.id)) {
      problems.push({ path: "markdown", message: "无排名时禁止出现具体名次" });
    }
  }
  return problems;
}
```

- [ ] **Step 4: 安装依赖并跑测试**

Run:

```bash
cd /Users/hongchaoling/Desktop/AgentHarness
pnpm install --filter @typescript-agent-harness/example-brief-agent...
cd examples/brief-agent && node --test --experimental-strip-types lib/schema.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add examples/brief-agent/package.json examples/brief-agent/tsconfig.json \
  examples/brief-agent/lib/schema.ts examples/brief-agent/lib/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(brief-agent): 脚手架与 Brief schema 校验

EOF
)"
```

---

### Task 2: resolveTargets（截断 8）

**Files:**
- Create: `examples/brief-agent/lib/targets.ts`
- Create: `examples/brief-agent/lib/targets.test.ts`
- Create: `examples/brief-agent/tools/resolve-targets.ts`

**Interfaces:**
- Consumes: `MAX_TARGETS`
- Produces: `resolveTargets(input) → { market: "DE"; targets: TargetRef[]; truncated: boolean }`
- `TargetRef = { id: string; url?: string; asin?: string; title?: string; query?: string }`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTargets } from "./targets.ts";

describe("resolveTargets", () => {
  it("caps at 8 and sets truncated", () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ id: `T${i}`, title: `Item ${i}` }));
    const out = resolveTargets({ market: "DE", targets: raw });
    assert.equal(out.targets.length, 8);
    assert.equal(out.truncated, true);
  });

  it("assigns ids when missing", () => {
    const out = resolveTargets({ targets: [{ title: "A" }, { asin: "B000" }] });
    assert.equal(out.targets[0]?.id.startsWith("t"), true);
    assert.equal(out.targets[1]?.id, "B000");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-strip-types lib/targets.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// lib/targets.ts
import { MAX_TARGETS } from "./schema.ts";

export type TargetRef = {
  id: string;
  url?: string;
  asin?: string;
  title?: string;
  query?: string;
};

export function resolveTargets(input: {
  market?: string;
  targets?: Array<Partial<TargetRef> & { text?: string }>;
  query?: string;
}): { market: "DE"; targets: TargetRef[]; truncated: boolean } {
  const market = "DE";
  let list = (input.targets ?? []).map((t, i) => {
    const asin = typeof t.asin === "string" ? t.asin : undefined;
    const id = (typeof t.id === "string" && t.id) || asin || `t${i + 1}`;
    return {
      id,
      url: typeof t.url === "string" ? t.url : undefined,
      asin,
      title: typeof t.title === "string" ? t.title : typeof t.text === "string" ? t.text : undefined,
      query: typeof t.query === "string" ? t.query : undefined,
    } satisfies TargetRef;
  });
  if (list.length === 0 && typeof input.query === "string" && input.query.trim()) {
    list = [{ id: "q1", query: input.query.trim(), title: input.query.trim() }];
  }
  const truncated = list.length > MAX_TARGETS;
  return { market, targets: list.slice(0, MAX_TARGETS), truncated };
}
```

```ts
// tools/resolve-targets.ts
import { defineTool } from "@typescript-agent-harness/cli";
import { resolveTargets } from "../lib/targets.ts";

export default defineTool({
  description: "把用户给的竞品 URL/ASIN/标题/类目词规范成目标列表。最多 8 个，超出截断并声明。market 固定 DE。",
  inputSchema: {
    type: "object",
    properties: {
      targets: { type: "array", items: { type: "object" } },
      query: { type: "string" },
      market: { type: "string" },
    },
    additionalProperties: false,
  },
  async execute(input: { targets?: unknown[]; query?: string; market?: string }) {
    return resolveTargets({
      market: input.market,
      query: input.query,
      targets: (input.targets ?? []) as Array<Record<string, string>>,
    });
  },
});
```

- [ ] **Step 4: 跑测试**

Run: `node --test --experimental-strip-types lib/targets.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add examples/brief-agent/lib/targets.ts examples/brief-agent/lib/targets.test.ts \
  examples/brief-agent/tools/resolve-targets.ts
git commit -m "$(cat <<'EOF'
feat(brief-agent): resolve_targets 截断至 8 个目标

EOF
)"
```

---

### Task 3: mock 档案 + fetch

**Files:**
- Create: `examples/brief-agent/data/mock-de.json`
- Create: `examples/brief-agent/lib/fetch.ts`
- Create: `examples/brief-agent/lib/fetch.test.ts`
- Create: `examples/brief-agent/tools/fetch-product-pages.ts`

**Interfaces:**
- Produces: `fetchProductPages({ ids, failIds? }) → { pages, failures }`
- Page shape: `{ id, title, priceEur: number | null, rank: number | null, bullets: string[], reviewSnippets: string[], changeNotes: string[] }`

- [ ] **Step 1: 写 mock 数据（至少 4 条；其中 `GAP1` 的 `priceEur` 为 null，`rank` 为 null）**

```json
{
  "market": "DE",
  "products": [
    {
      "id": "B001",
      "title": "Dekotablett Holz 30cm",
      "priceEur": 24.99,
      "rank": null,
      "bullets": ["Akazie", "30cm", "rutschfest"],
      "reviewSnippets": ["schön verarbeitet", "etwas klein", "guter Preis"],
      "changeNotes": ["listing title stable"]
    },
    {
      "id": "B002",
      "title": "Edelstahl Tablett",
      "priceEur": 19.9,
      "rank": null,
      "bullets": ["Edelstahl", "spülmaschinenfest"],
      "reviewSnippets": ["Rost an Kante", "schwer", "sieht edel aus"],
      "changeNotes": []
    },
    {
      "id": "B003",
      "title": "Marmoroptik Tablett",
      "priceEur": 29.5,
      "rank": null,
      "bullets": ["Marmoroptik", "Griff"],
      "reviewSnippets": ["leicht zerkratzt", "stabil", "Farbe weicht ab"],
      "changeNotes": ["bullet 2 wording changed in mock history"]
    },
    {
      "id": "GAP1",
      "title": "Bambus Tablett (缺价)",
      "priceEur": null,
      "rank": null,
      "bullets": ["Bambus"],
      "reviewSnippets": ["leicht", "Geruch am Anfang"],
      "changeNotes": []
    }
  ]
}
```

- [ ] **Step 2: 写失败测试**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchProductPages } from "./fetch.ts";

describe("fetchProductPages", () => {
  it("returns pages for known ids", async () => {
    const out = await fetchProductPages({ ids: ["B001", "B002"] });
    assert.equal(out.pages.length, 2);
    assert.equal(out.failures.length, 0);
    assert.equal(out.pages[0]?.priceEur, 24.99);
  });

  it("records failures for missing or injected fail ids", async () => {
    const out = await fetchProductPages({ ids: ["B001", "NOPE"], failIds: ["B001"] });
    assert.equal(out.pages.length, 0);
    assert.ok(out.failures.some((f) => f.id === "B001"));
    assert.ok(out.failures.some((f) => f.id === "NOPE"));
  });

  it("keeps null price for GAP1", async () => {
    const out = await fetchProductPages({ ids: ["GAP1"] });
    assert.equal(out.pages[0]?.priceEur, null);
  });
});
```

- [ ] **Step 3: 跑测试确认失败** → **Step 4: 实现 fetch + tool**

```ts
// lib/fetch.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Failure } from "./schema.ts";

const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

export type ProductPage = {
  id: string;
  title: string;
  priceEur: number | null;
  rank: number | null;
  bullets: string[];
  reviewSnippets: string[];
  changeNotes: string[];
};

type MockFile = { products: ProductPage[] };

export function loadMockCatalog(): ProductPage[] {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "data", "mock-de.json"), "utf8")) as MockFile;
  return raw.products;
}

export async function fetchProductPages(input: {
  ids: string[];
  failIds?: string[];
}): Promise<{ pages: ProductPage[]; failures: Failure[] }> {
  const catalog = new Map(loadMockCatalog().map((p) => [p.id, p]));
  const failSet = new Set(input.failIds ?? []);
  const pages: ProductPage[] = [];
  const failures: Failure[] = [];
  for (const id of input.ids) {
    if (failSet.has(id)) {
      failures.push({ id, stage: "fetch", message: "injected fetch failure" });
      continue;
    }
    const page = catalog.get(id);
    if (!page) {
      failures.push({ id, stage: "fetch", message: "not found in mock catalog" });
      continue;
    }
    pages.push(page);
  }
  return { pages, failures };
}
```

Tool `fetch-product-pages.ts`：`execute` 调 `fetchProductPages`，`ids` 必填；可选 `failIds` 仅用于 eval（description 写明生产勿用）。

- [ ] **Step 5: 跑测试 PASS → Commit**

```bash
git add examples/brief-agent/data/mock-de.json examples/brief-agent/lib/fetch.ts \
  examples/brief-agent/lib/fetch.test.ts examples/brief-agent/tools/fetch-product-pages.ts
git commit -m "$(cat <<'EOF'
feat(brief-agent): mock DE 档案与 fetch_product_pages

EOF
)"
```

---

### Task 4: 四桶信号抽取 + submit_signals

**Files:**
- Create: `examples/brief-agent/lib/signals.ts`
- Create: `examples/brief-agent/lib/signals.test.ts`
- Create: `examples/brief-agent/tools/submit-signals.ts`
- Create: `examples/brief-agent/tools/signal-pricing.ts`
- Create: `examples/brief-agent/tools/signal-positioning.ts`
- Create: `examples/brief-agent/tools/signal-reviews.ts`
- Create: `examples/brief-agent/tools/signal-changes.ts`

**Interfaces:**
- Produces: `extractSignalsFromPage(page) → TargetSignals`（Eval 假子 Agent 用）
- 四个 `signal_*` 工具：输入 `id`，从 mock 读对应桶（只读）
- `submit_signals`：接受完整 `TargetSignals` 字段，返回 `{ accepted: true, id }`

- [ ] **Step 1: 测试**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSignalsFromPage } from "./signals.ts";
import { loadMockCatalog } from "./fetch.ts";

describe("extractSignalsFromPage", () => {
  it("builds ≥3 evidence and preserves null price", () => {
    const gap = loadMockCatalog().find((p) => p.id === "GAP1")!;
    const sig = extractSignalsFromPage(gap);
    const all = [
      ...sig.buckets.pricing.evidence,
      ...sig.buckets.positioning.evidence,
      ...sig.buckets.reviews.evidence,
      ...sig.buckets.changes.evidence,
    ];
    assert.ok(all.length >= 3);
    assert.equal(sig.buckets.pricing.priceEur, null);
  });
});
```

- [ ] **Step 2: 实现 `extractSignalsFromPage`**

规则：
- `pricing.priceEur` 原样（可为 null）；evidence 写「有价 €x」或「缺价格」
- `positioning.bullets` 来自 page.bullets
- `reviews.themes`：对 snippets 做朴素去重关键词（德/中混写均可，保持简单）
- `changes.notes` 来自 changeNotes；空则 evidence 写「无变更记录」
- 合并后 evidence 总数 ≥3（测试靠此）

四个 signal 工具：按 `id` 调 `loadMockCatalog`，返回单桶；找不到返回 `{ error: "..." }`。

`submit-signals.ts`：对齐 selection-agent `submit-candidate`（accepted + id）。

- [ ] **Step 3: 测试 PASS → Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(brief-agent): 四桶信号抽取与 submit_signals

EOF
)"
```

---

### Task 5: compose + save

**Files:**
- Create: `examples/brief-agent/lib/compose.ts`
- Create: `examples/brief-agent/lib/compose.test.ts`
- Create: `examples/brief-agent/lib/save.ts`
- Create: `examples/brief-agent/lib/save.test.ts`
- Create: `examples/brief-agent/lib/events.ts`
- Create: `examples/brief-agent/tools/compose-brief.ts`
- Create: `examples/brief-agent/tools/save-brief.ts`

**Interfaces:**
- `composeBrief({ market, signals, failures, truncated, conclusion? }) → Brief`
- `saveBrief(brief) → { jsonPath, mdPath, markdown }`
- markdown **不得**在 `priceEur===null` 的行写 € 数字；**不得**在 `rank===null` 时写名次

- [ ] **Step 1: compose 测试**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSignalsFromPage, /* or build signals */ } from "./signals.ts";
import { loadMockCatalog } from "./fetch.ts";
import { composeBrief } from "./compose.ts";
import { validateBrief } from "./schema.ts";

describe("composeBrief", () => {
  it("marks 缺价格 gap and passes validateBrief", () => {
    const pages = loadMockCatalog().filter((p) => ["B001", "GAP1"].includes(p.id));
    const signals = pages.map(extractSignalsFromPage);
    const brief = composeBrief({
      market: "DE",
      signals,
      failures: [],
      truncated: false,
    });
    assert.ok(brief.gaps.some((g) => /缺价格/.test(g)));
    assert.equal(validateBrief(brief).length, 0);
    assert.equal(/€\s*\d/.test(brief.markdown) && brief.markdown.includes("Bambus"), false);
  });
});
```

- [ ] **Step 2: 实现 compose**

- 每行：从 buckets 填 `priceEur` / `bullets` / `reviewThemes` / `changes`；`rank` 固定 `null`（mock 无排名）
- `evidence`：四桶 evidence 拼接，至少保留 3 条
- `gaps`：缺价格、无变更、fetch failures 等去重列表
- `conclusion`：若有可用行 → 「本批可对照观察」；若全失败 → 「本次无可用证据」
- `markdown` 固定四块：`### 结论` / `### 对照表` / `### 差评主题` / `### 缺口`；对照表价格列：有价写 `€xx.xx`，否则写 `缺数据`

- [ ] **Step 3: save 测试 + 实现**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { saveBrief, setBriefOutDirForTest } from "./save.ts";
import type { Brief } from "./schema.ts";

describe("saveBrief", () => {
  it("writes json and md", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brief-"));
    setBriefOutDirForTest(dir);
    const brief = {
      market: "DE",
      conclusion: "x",
      rows: [],
      gaps: [],
      failures: [],
      truncated: false,
      markdown: "### 结论\nx\n",
    } satisfies Brief;
    const out = saveBrief(brief);
    assert.equal(readFileSync(out.jsonPath, "utf8").includes('"market": "DE"'), true);
    assert.equal(readFileSync(out.mdPath, "utf8"), brief.markdown);
    setBriefOutDirForTest(null);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

`save.ts`：默认 `out/briefs/` 相对项目根；`setBriefOutDirForTest` 仅测试用。

Tools：`compose_brief` 收 `signals`/`failures`/`truncated`；`save_brief` 收整个 brief 或先 compose 再 save——**推荐 `save_brief` 只负责落盘**，主 Skill 顺序 `compose_brief` → `save_brief`；也可提供 `compose_and_save` 单工具防模型篡改。P0 选 **合并工具 `compose_and_save`**（一个 execute：compose → validate → save），另保留 `compose_brief` 只返回不落盘便于测。为减工具数：只实现 **`compose_brief`（返回 brief含 markdown）** + **`save_brief`（校验后落盘）**。

- [ ] **Step 4: 测试 PASS → Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(brief-agent): compose_brief 与 save_brief 落盘

EOF
)"
```

---

### Task 6: extract 编排（无 LLM）+ extract_signals 工具

**Files:**
- Create: `examples/brief-agent/lib/extract.ts`
- Create: `examples/brief-agent/lib/extract.test.ts`
- Create: `examples/brief-agent/tools/extract-signals.ts`

**Interfaces:**
- `extractSignalsForPages(pages, { concurrency?, retryFailIds? }) → { signals, failures }`
- 假子 Agent = `extractSignalsFromPage`；可选对某 id 第一次抛错以测「记失败不中断」

- [ ] **Step 1–4: TDD 实现有界并发（可内联简单版，不必抄满 selection subagent）**

```ts
export async function extractSignalsForPages(
  pages: ProductPage[],
  opts?: { concurrency?: number },
): Promise<{ signals: TargetSignals[]; failures: Failure[] }> {
  const concurrency = Math.min(8, Math.max(1, opts?.concurrency ?? 3));
  // run with pool; on throw → failures push; continue
}
```

`extract-signals` 工具：输入 `pages`（fetch 原样）+ `concurrency`；内部调 `extractSignalsForPages`。真模型路径下主 Agent 可改调 `run_subagent`——P0 工具内**直接**跑假抽取即可（与 selection 的 research 在真聊里用子 Agent 不同）；若要坚持真 `run_subagent`，在 AGENTS.md 写清任务模板，Eval 仍走 `extractSignalsForPages`。

**P0 决定（写死）：** `extract_signals` 工具内程序化抽取（不调 LLM）。真聊同样稳定可演示；Skill 仍写「调用 extract_signals」。子 Agent / `run_subagent` 留 P1。

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(brief-agent): extract_signals 程序化并发取证

EOF
)"
```

---

### Task 7: AGENTS.md + Skill + run-log + README + smoke

**Files:**
- Create: `examples/brief-agent/AGENTS.md`
- Create: `examples/brief-agent/skills/competitive-brief/SKILL.md`
- Create: `examples/brief-agent/plugins/run-log.ts`
- Create: `examples/brief-agent/README.md`
- Create: `examples/brief-agent/scripts/smoke.ts`

- [ ] **Step 1: 写 AGENTS.md**（铁律对齐 spec；回复四块：结论 / 对照表 / 差评主题 / 缺口；数字只来自工具）

- [ ] **Step 2: Skill `competitive-brief`**

顺序强制：
1. `resolve_targets`
2. `fetch_product_pages`（ids 来自上一步）
3. `extract_signals`（pages 原样）
4. `compose_brief`（signals + failures + truncated 原样）
5. `save_brief`（brief 原样）
6. 回复只贴 `save_brief` / `compose_brief` 的 markdown，不重写数字

- [ ] **Step 3: run-log plugin**（抄 selection，字段用 `id` 替代 `asin`）

- [ ] **Step 4: smoke.ts**

```ts
import { resolveTargets } from "../lib/targets.ts";
import { fetchProductPages } from "../lib/fetch.ts";
import { extractSignalsForPages } from "../lib/extract.ts";
import { composeBrief } from "../lib/compose.ts";
import { saveBrief } from "../lib/save.ts";
import { validateBrief } from "../lib/schema.ts";

const resolved = resolveTargets({
  targets: [{ id: "B001" }, { id: "B002" }, { id: "B003" }],
});
const fetched = await fetchProductPages({ ids: resolved.targets.map((t) => t.id) });
const extracted = await extractSignalsForPages(fetched.pages);
const brief = composeBrief({
  market: "DE",
  signals: extracted.signals,
  failures: [...fetched.failures, ...extracted.failures],
  truncated: resolved.truncated,
});
if (validateBrief(brief).length) throw new Error("invalid brief");
const saved = saveBrief(brief);
console.log("ok", saved.mdPath);
```

Run: `pnpm smoke` → Expected: 打印 `ok …/out/briefs/….md`

- [ ] **Step 5: README**（start / smoke / eval / 与 selection 同构说明）

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(brief-agent): AGENTS、Skill、run-log 与 smoke

EOF
)"
```

---

### Task 8: Eval 五用例

**Files:**
- Create: `examples/brief-agent/eval/assert-brief.ts`
- Create: `examples/brief-agent/eval/assert-brief.test.ts`
- Create: `examples/brief-agent/eval/run-eval.ts`
- Create: `examples/brief-agent/eval/cases/happy-mock-3.json`
- Create: `examples/brief-agent/eval/cases/gap-missing-price.json`
- Create: `examples/brief-agent/eval/cases/cap-over-8.json`
- Create: `examples/brief-agent/eval/cases/partial-fetch-fail.json`
- Create: `examples/brief-agent/eval/cases/no-invent-rank.json`

**Interfaces:**
- Cases 驱动：`kind: "pipeline" | "resolve-only" | "validate-markdown"`
- Runner 写 `out/eval/<id>/trace.jsonl`

- [ ] **Step 1: case 文件**

`happy-mock-3.json`:

```json
{
  "id": "happy-mock-3",
  "kind": "pipeline",
  "ids": ["B001", "B002", "B003"],
  "expectMinEvidence": 3,
  "expectFiles": true
}
```

`gap-missing-price.json`:

```json
{
  "id": "gap-missing-price",
  "kind": "pipeline",
  "ids": ["GAP1", "B001"],
  "expectGapSubstring": "缺价格",
  "forbidEuroOnTitles": ["Bambus Tablett"]
}
```

`cap-over-8.json`:

```json
{
  "id": "cap-over-8",
  "kind": "resolve-only",
  "targets": [0,1,2,3,4,5,6,7,8,9,10,11],
  "expectCount": 8,
  "expectTruncated": true
}
```

`partial-fetch-fail.json`:

```json
{
  "id": "partial-fetch-fail",
  "kind": "pipeline",
  "ids": ["B001", "B002"],
  "failIds": ["B001"],
  "expectFailureId": "B001",
  "expectRowIds": ["B002"]
}
```

`no-invent-rank.json`:

```json
{
  "id": "no-invent-rank",
  "kind": "validate-markdown",
  "ids": ["B001"],
  "injectMarkdown": "B001 位列第 3 名",
  "expectValidateFail": true
}
```

- [ ] **Step 2: 实现 `run-eval.ts`**

对 `pipeline`：resolve（若需要）→ fetch（带 failIds）→ extract → compose → validate → save → 断言。  
对 `resolve-only`：只测 `resolveTargets`。  
对 `validate-markdown`：compose 后改 markdown 再 `validateBrief`，期望有 problem。

退出码：任一失败 → `process.exit(1)`；成功打印 `5/5 PASS`。

- [ ] **Step 3: 跑 eval**

Run: `cd examples/brief-agent && pnpm eval`  
Expected: `5/5 PASS`

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(brief-agent): 无模型 Eval 五用例

EOF
)"
```

---

### Task 9: 收尾核对

- [ ] **Step 1: 全量测试**

```bash
cd examples/brief-agent && pnpm test && pnpm smoke && pnpm eval
```

Expected: 全绿

- [ ] **Step 2: 更新 design spec 状态行**

`docs/superpowers/specs/2026-11-19-brief-agent-design.md` 开头改为：`状态：P0 已实现（见 examples/brief-agent；计划 docs/superpowers/plans/2026-11-19-brief-agent.md）`。

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(brief-agent): 标记 P0 已实现并核对验收

EOF
)"
```

---

## Self-review（对照 spec）

| Spec 要求 | Task |
| --- | --- |
| 约定式 `examples/brief-agent` | 1, 7 |
| Skill `competitive-brief` 路径 | 7 |
| resolve / fetch / extract / compose / save | 2–6 |
| 上限 8、failures、缺数据 | 2, 3, 5 |
| mock DE、四桶信号 | 3, 4 |
| Eval 五用例 | 8 |
| run-log、smoke | 7 |
| 不做 Super-agent/真抓/多站点 | Global Constraints |
| 不改核心包 | Global Constraints |

占位符扫描：无 TBD；P1 `run_subagent` 已标明不进 P0。  
类型名：`TargetSignals` / `Brief` / `Failure` 前后一致。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-19-brief-agent.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 Task 派一个新子代理，Task 间审查，迭代快  

**2. Inline Execution** — 本会话用 executing-plans 按 Task 推进，设检查点  

Which approach?
