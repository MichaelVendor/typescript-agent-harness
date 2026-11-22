/**
 * Brief-agent 无模型评测入口。
 *
 * Cases：pipeline | resolve-only | validate-markdown
 * Trace：out/eval/<id>/trace.jsonl
 *
 *   node --experimental-strip-types eval/run-eval.ts
 *   pnpm eval
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFailureId,
  assertGapSubstring,
  assertMinEvidence,
  assertNoEuroOnTitles,
  assertRowIds,
  assertSavedFiles,
  assertValidateOutcome,
  firstFailure,
  type AssertResult,
} from "./assert-brief.ts";
import { composeBrief } from "../lib/compose.ts";
import { diffBriefRows } from "../lib/diff-brief.ts";
import { extractSignalsForPages } from "../lib/extract.ts";
import { fetchProductPages } from "../lib/fetch.ts";
import { PROJECT_ROOT, saveBrief } from "../lib/save.ts";
import { validateBrief, type Brief, type BriefRow } from "../lib/schema.ts";
import { liveDeSearchSource } from "../lib/sources/live-de-search.ts";
import { resolveTargets, type TargetRef } from "../lib/targets.ts";


const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CASES_DIR = path.join(ROOT, "eval", "cases");
const EVAL_OUT = path.join(PROJECT_ROOT, "out", "eval");

type TraceEntry = { tool: string; ok?: boolean };

type CaseBase = { id: string; kind: string };

type PipelineCase = CaseBase & {
  kind: "pipeline";
  ids: string[];
  failIds?: string[];
  expectMinEvidence?: number;
  expectFiles?: boolean;
  expectGapSubstring?: string;
  forbidEuroOnTitles?: string[];
  expectFailureId?: string;
  expectRowIds?: string[];
};

type ResolveOnlyCase = CaseBase & {
  kind: "resolve-only";
  targets: number[];
  expectCount: number;
  expectTruncated: boolean;
};

type ValidateMarkdownCase = CaseBase & {
  kind: "validate-markdown";
  ids: string[];
  injectMarkdown: string;
  expectValidateFail: boolean;
};

type LiveFetchCase = CaseBase & {
  kind: "live-fetch";
  fixture: string;
  targets: TargetRef[];
  expectPrice?: boolean;
  expectTitleSubstring?: string;
  expectBlocked?: boolean;
  dpFixture?: string;
  reviewsFixture?: string;
  expectMinBullets?: number;
  expectMinReviews?: number;
};

type DiffUnitCase = CaseBase & {
  kind: "diff-unit";
  expectArrow?: boolean;
  expectNoPrevious?: boolean;
};

type TemplateUnitCase = CaseBase & {
  kind: "template-unit";
  ids: string[];
  template: "exec" | "ops";
  forbidHeading?: string;
  requireHeading?: string;
  maxTableRows?: number;
  /** 不得出现在「### 差评主题」与下一节之间。 */
  forbidInConsSection?: string;
};

type EvalCase =
  | PipelineCase
  | ResolveOnlyCase
  | ValidateMarkdownCase
  | LiveFetchCase
  | DiffUnitCase
  | TemplateUnitCase;

type CaseResult = { id: string; ok: boolean; detail: string };

function loadCases(): EvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(CASES_DIR, name), "utf8")) as EvalCase);
}

function writeTrace(caseId: string, trace: TraceEntry[]): string {
  const dir = path.join(EVAL_OUT, caseId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "trace.jsonl");
  writeFileSync(
    file,
    trace.map((row) => JSON.stringify({ at: new Date().toISOString(), ...row })).join("\n") + "\n",
  );
  return file;
}

async function record<T>(
  trace: TraceEntry[],
  tool: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  try {
    const value = await fn();
    trace.push({ tool, ok: true });
    return value;
  } catch (error) {
    trace.push({ tool, ok: false });
    throw error;
  }
}

function assertPipeline(c: PipelineCase, brief: Parameters<typeof validateBrief>[0], saved?: {
  jsonPath: string;
  mdPath: string;
}): AssertResult {
  const checks: AssertResult[] = [];
  const problems = validateBrief(brief);
  checks.push(assertValidateOutcome(problems, false));

  if (typeof c.expectMinEvidence === "number") {
    checks.push(assertMinEvidence(brief, c.expectMinEvidence));
  }
  if (typeof c.expectGapSubstring === "string") {
    checks.push(assertGapSubstring(brief, c.expectGapSubstring));
  }
  if (c.forbidEuroOnTitles?.length) {
    checks.push(assertNoEuroOnTitles(brief.markdown, c.forbidEuroOnTitles));
  }
  if (typeof c.expectFailureId === "string") {
    checks.push(assertFailureId(brief, c.expectFailureId));
  }
  if (c.expectRowIds) {
    checks.push(assertRowIds(brief, c.expectRowIds));
  }
  if (c.expectFiles) {
    if (!saved) return { ok: false, reason: "expectFiles 但未 save" };
    checks.push(assertSavedFiles(saved));
  }
  return firstFailure(...checks);
}

async function runPipeline(c: PipelineCase): Promise<CaseResult> {
  const trace: TraceEntry[] = [];

  const resolved = await record(trace, "resolve_targets", () =>
    resolveTargets({ targets: c.ids.map((id) => ({ id })) }),
  );
  const ids = resolved.targets.map((t) => t.id);

  const fetchArgs: Parameters<typeof fetchProductPages>[0] = { ids };
  if (c.failIds !== undefined) fetchArgs.failIds = c.failIds;
  const fetched = await record(trace, "fetch_product_pages", () => fetchProductPages(fetchArgs));

  const extracted = await record(trace, "extract_signals", () =>
    extractSignalsForPages(fetched.pages),
  );

  const brief = await record(trace, "compose_brief", () =>
    composeBrief({
      market: "DE",
      signals: extracted.signals,
      failures: [...fetched.failures, ...extracted.failures],
      truncated: resolved.truncated,
      skipDiff: true,
    }),
  );

  await record(trace, "validate_brief", () => {
    const problems = validateBrief(brief);
    if (problems.length) throw new Error(problems.map((p) => p.message).join("; "));
    return problems;
  });

  const saved = await record(trace, "save_brief", () => saveBrief(brief));
  const check = assertPipeline(c, brief, saved);
  const file = writeTrace(c.id, trace);
  if (!check.ok) {
    return { id: c.id, ok: false, detail: `${check.reason}；trace→${file}` };
  }
  return {
    id: c.id,
    ok: true,
    detail: `PASS rows=${brief.rows.length} gaps=${brief.gaps.length} trace→${file}`,
  };
}

function runResolveOnly(c: ResolveOnlyCase): CaseResult {
  const trace: TraceEntry[] = [];
  const resolved = resolveTargets({
    targets: c.targets.map((n) => ({ id: `n${n}` })),
  });
  trace.push({ tool: "resolve_targets", ok: true });
  const file = writeTrace(c.id, trace);

  const countOk = resolved.targets.length === c.expectCount;
  const truncOk = resolved.truncated === c.expectTruncated;
  if (!countOk || !truncOk) {
    return {
      id: c.id,
      ok: false,
      detail: `count=${resolved.targets.length} truncated=${resolved.truncated}；期望 ${c.expectCount}/${c.expectTruncated}；trace→${file}`,
    };
  }
  return {
    id: c.id,
    ok: true,
    detail: `PASS count=${resolved.targets.length} truncated=${resolved.truncated} trace→${file}`,
  };
}

async function runTemplateUnit(c: TemplateUnitCase): Promise<CaseResult> {
  const trace: TraceEntry[] = [];
  const resolved = await record(trace, "resolve_targets", () =>
    resolveTargets({ targets: c.ids.map((id) => ({ id })) }),
  );
  const fetched = await record(trace, "fetch_product_pages", () =>
    fetchProductPages({ ids: resolved.targets.map((t) => t.id) }),
  );
  const extracted = await record(trace, "extract_signals", () =>
    extractSignalsForPages(fetched.pages),
  );
  const brief = await record(trace, "compose_brief", () =>
    composeBrief({
      market: "DE",
      signals: extracted.signals,
      failures: [...fetched.failures, ...extracted.failures],
      truncated: resolved.truncated,
      skipDiff: true,
      template: c.template,
    }),
  );
  const file = writeTrace(c.id, trace);
  if (c.requireHeading && !brief.markdown.includes(c.requireHeading)) {
    return { id: c.id, ok: false, detail: `缺 ${c.requireHeading}；trace→${file}` };
  }
  if (c.forbidHeading && brief.markdown.includes(c.forbidHeading)) {
    return { id: c.id, ok: false, detail: `不应出现 ${c.forbidHeading}；trace→${file}` };
  }
  if (c.forbidInConsSection) {
    const after = brief.markdown.split("### 差评主题")[1] ?? "";
    const consOnly = after.split("\n### ")[0] ?? after;
    if (consOnly.includes(c.forbidInConsSection)) {
      return {
        id: c.id,
        ok: false,
        detail: `差评栏含「${c.forbidInConsSection}」；trace→${file}`,
      };
    }
  }
  if (typeof c.maxTableRows === "number") {
    const tableRows = brief.markdown.split("\n").filter((l) => /^\\| [A-Z0-9]/.test(l) && !l.includes("---"));
    // rows like "| B001 |"
    const dataRows = brief.markdown.split("\n").filter((l) => /^\| (B|G|t)/.test(l));
    if (dataRows.length > c.maxTableRows) {
      return {
        id: c.id,
        ok: false,
        detail: `对照行 ${dataRows.length} > ${c.maxTableRows}；trace→${file}`,
      };
    }
    void tableRows;
  }
  return { id: c.id, ok: true, detail: `PASS template=${c.template} trace→${file}` };
}

function runDiffUnit(c: DiffUnitCase): CaseResult {
  const trace: TraceEntry[] = [{ tool: "diff_brief_rows", ok: true }];
  const file = writeTrace(c.id, trace);

  if (c.expectNoPrevious) {
    const lines = diffBriefRows(null, [
      {
        id: "B001",
        title: "x",
        priceEur: 1,
        rank: null,
        bullets: [],
        reviewThemes: [],
        changes: [],
        evidence: [
          { claim: "a", source: "t", detail: "1" },
          { claim: "b", source: "t", detail: "2" },
          { claim: "c", source: "t", detail: "3" },
        ],
      },
    ]);
    if (!lines.includes("无上次简报可对比")) {
      return { id: c.id, ok: false, detail: `got ${JSON.stringify(lines)}；trace→${file}` };
    }
    return { id: c.id, ok: true, detail: `PASS no-previous trace→${file}` };
  }

  if (c.expectArrow) {
    const prevRow: BriefRow = {
      id: "B001",
      title: "Tray",
      priceEur: 24.99,
      rank: null,
      bullets: ["a"],
      reviewThemes: [],
      changes: [],
      evidence: [
        { claim: "a", source: "t", detail: "1" },
        { claim: "b", source: "t", detail: "2" },
        { claim: "c", source: "t", detail: "3" },
      ],
    };
    const prev: Brief = {
      market: "DE",
      conclusion: "x",
      rows: [prevRow],
      gaps: [],
      failures: [],
      truncated: false,
      markdown: "x",
    };
    const curr = [{ ...prevRow, priceEur: 22.0 }];
    const lines = diffBriefRows(prev, curr);
    if (!lines.some((l) => l.includes("→") && /价格/.test(l))) {
      return { id: c.id, ok: false, detail: `got ${JSON.stringify(lines)}；trace→${file}` };
    }
    return { id: c.id, ok: true, detail: `PASS price-arrow trace→${file}` };
  }

  return { id: c.id, ok: false, detail: `未识别断言；trace→${file}` };
}

async function runLiveFetch(c: LiveFetchCase): Promise<CaseResult> {
  const trace: TraceEntry[] = [];
  const html = readFileSync(path.join(ROOT, "data", "fixtures", c.fixture), "utf8");
  const dpHtml = c.dpFixture
    ? readFileSync(path.join(ROOT, "data", "fixtures", c.dpFixture), "utf8")
    : "";
  const reviewsHtml = c.reviewsFixture
    ? readFileSync(path.join(ROOT, "data", "fixtures", c.reviewsFixture), "utf8")
    : "";
  const out = await record(trace, "fetch_product_pages", () =>
    liveDeSearchSource.fetchPages({
      targets: c.targets,
      fetchHtml: async () => html,
      fetchDpHtml: async () => dpHtml,
      fetchReviewsHtml: async () => reviewsHtml,
      browserEnabled: false,
    }),
  );
  const file = writeTrace(c.id, trace);

  if (c.expectBlocked) {
    const blocked = out.failures.some((f) => /blocked/i.test(f.message));
    if (!blocked || out.pages.length > 0) {
      return {
        id: c.id,
        ok: false,
        detail: `期望 blocked；pages=${out.pages.length} failures=${JSON.stringify(out.failures)}；trace→${file}`,
      };
    }
    return { id: c.id, ok: true, detail: `PASS blocked trace→${file}` };
  }

  const page = out.pages[0];
  if (!page) {
    return { id: c.id, ok: false, detail: `无 page；failures=${JSON.stringify(out.failures)}；trace→${file}` };
  }
  if (c.expectPrice && !(typeof page.priceEur === "number" && Number.isFinite(page.priceEur))) {
    return { id: c.id, ok: false, detail: `缺价格；trace→${file}` };
  }
  if (c.expectTitleSubstring && !page.title.includes(c.expectTitleSubstring)) {
    return { id: c.id, ok: false, detail: `title=${page.title}；trace→${file}` };
  }
  if (typeof c.expectMinBullets === "number" && page.bullets.length < c.expectMinBullets) {
    return {
      id: c.id,
      ok: false,
      detail: `bullets=${page.bullets.length} < ${c.expectMinBullets}；trace→${file}`,
    };
  }
  if (typeof c.expectMinReviews === "number" && page.reviewSnippets.length < c.expectMinReviews) {
    return {
      id: c.id,
      ok: false,
      detail: `reviews=${page.reviewSnippets.length} < ${c.expectMinReviews}；trace→${file}`,
    };
  }
  return {
    id: c.id,
    ok: true,
    detail: `PASS price=${page.priceEur} title=${page.title} bullets=${page.bullets.length} trace→${file}`,
  };
}

async function runValidateMarkdown(c: ValidateMarkdownCase): Promise<CaseResult> {
  const trace: TraceEntry[] = [];

  const resolved = await record(trace, "resolve_targets", () =>
    resolveTargets({ targets: c.ids.map((id) => ({ id })) }),
  );
  const fetched = await record(trace, "fetch_product_pages", () =>
    fetchProductPages({ ids: resolved.targets.map((t) => t.id) }),
  );
  const extracted = await record(trace, "extract_signals", () =>
    extractSignalsForPages(fetched.pages),
  );
  const brief = await record(trace, "compose_brief", () =>
    composeBrief({
      market: "DE",
      signals: extracted.signals,
      failures: [...fetched.failures, ...extracted.failures],
      truncated: resolved.truncated,
      skipDiff: true,
    }),
  );

  const injected = { ...brief, markdown: c.injectMarkdown };
  const problems = await record(trace, "validate_brief", () => validateBrief(injected));
  const check = assertValidateOutcome(problems, c.expectValidateFail);
  const file = writeTrace(c.id, trace);
  if (!check.ok) {
    return { id: c.id, ok: false, detail: `${check.reason}；trace→${file}` };
  }
  return {
    id: c.id,
    ok: true,
    detail: `PASS validate problems=${problems.length} trace→${file}`,
  };
}

async function main(): Promise<void> {
  mkdirSync(EVAL_OUT, { recursive: true });
  const cases = loadCases();
  const results: CaseResult[] = [];

  for (const item of cases) {
    process.stdout.write(`• ${item.id} … `);
    let result: CaseResult;
    try {
      if (item.kind === "pipeline") result = await runPipeline(item);
      else if (item.kind === "resolve-only") result = runResolveOnly(item);
      else if (item.kind === "validate-markdown") result = await runValidateMarkdown(item);
      else if (item.kind === "live-fetch") result = await runLiveFetch(item);
      else if (item.kind === "diff-unit") result = runDiffUnit(item);
      else if (item.kind === "template-unit") result = await runTemplateUnit(item);
      else result = { id: (item as CaseBase).id, ok: false, detail: "未知 kind" };
    } catch (error) {
      result = {
        id: (item as CaseBase).id,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(result);
    console.log(result.ok ? `PASS  ${result.detail}` : `FAIL  ${result.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;
  console.log(`\n${passed}/${results.length} ${failed.length ? "FAIL" : "PASS"}`);
  if (failed.length) process.exit(1);
}

await main();
