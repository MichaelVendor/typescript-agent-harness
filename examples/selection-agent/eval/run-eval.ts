/**
 * 应用层 Agent 评测入口（不起真模型）。
 *
 * 知识点串联：
 * 1. 闸门 — requireMarketplace / set_marketplace
 * 2. 工具环 — search → research → score（程序化调用，记录 trace）
 * 3. Trace 断言 — assert-trace 锁工具顺序
 * 4. 规则打分 — scoreCandidate，缺维进 gaps，禁止臆造
 *
 *   node --experimental-strip-types eval/run-eval.ts
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertToolOrder, type TraceEntry } from "./assert-trace.ts";
import { clearLiveMarketplace } from "../lib/marketplace.ts";
import { competitionScore, DEMAND_POINTS, marginScore, piecewise, trendScore, unitEstimate } from "../lib/normalize.ts";
import { buildReport, PROJECT_ROOT, saveReport } from "../lib/report.ts";
import { validateCandidates, type Candidate } from "../lib/schema.ts";
import { rankCandidates, scoreCandidate } from "../lib/score.ts";
import { activeMarketSource } from "../lib/sources/index.ts";
import { DEMAND_POINTS_DE } from "../tools/keyword-metrics.ts";
import searchProducts from "../tools/search-products.ts";
import setMarketplace from "../tools/set-marketplace.ts";

const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CASES_DIR = path.join(ROOT, "eval", "cases");
const EVAL_OUT = path.join(PROJECT_ROOT, "out", "eval");

type CaseBase = { id: string; kind: string; title?: string };
type PipelineCase = CaseBase & {
  kind: "pipeline";
  marketplace: "DE" | "US";
  query: string;
  expectOrder: string[];
  expectCurrency: "EUR" | "USD";
};
type GateSearchCase = CaseBase & { kind: "gate-search"; query: string };
type TraceUnitCase = CaseBase & {
  kind: "trace-unit";
  badTrace: string[];
  expectOrder: string[];
  expectMatch: boolean;
};
type ScoreGapsCase = CaseBase & { kind: "score-gaps"; expectGap: string };
type EvalCase = PipelineCase | GateSearchCase | TraceUnitCase | ScoreGapsCase;

type CaseResult = { id: string; ok: boolean; detail: string };

function loadCases(): EvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(CASES_DIR, name), "utf8")) as EvalCase);
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** 假「研究」：用当前 MarketSource 四件套拼候选，不走 LLM（对齐 smoke-orchestration 思路）。 */
async function researchWithoutLlm(
  products: { asin: string; title: string; category: string; marketplace: string; priceUsd: number }[],
  demandPoints: typeof DEMAND_POINTS,
): Promise<Candidate[]> {
  const source = activeMarketSource();
  const out: Candidate[] = [];
  for (const product of products.slice(0, 3)) {
    const [kw, comp, cost, legal] = await Promise.all([
      source.keywordMetrics(product.asin),
      source.competitorSnapshot(product.asin),
      source.landedCost(product.asin, { priceUsd: product.priceUsd }),
      source.complianceCheck(product.asin),
    ]);
    if (!kw || !comp || !cost || !legal) continue;
    const units = unitEstimate(kw.monthlySearchVolume);
    out.push({
      id: product.asin,
      title: product.title,
      category: product.category,
      marketplace: product.marketplace,
      priceUsd: product.priceUsd,
      metrics: {
        demand: round(piecewise(kw.monthlySearchVolume, demandPoints)),
        trend: typeof kw.trend3m === "number" ? round(trendScore(kw.trend3m)) : null,
        competition: competitionScore(comp.lowReviewShare, comp.brandConcentration),
        margin: round(marginScore(cost.netMargin)),
      },
      monthlyProfitUsd: {
        low: Math.round(cost.netProfitUsd * units.low),
        mid: Math.round(cost.netProfitUsd * units.mid),
        high: Math.round(cost.netProfitUsd * units.high),
      },
      monthlyUnits: units,
      riskFlags: legal.riskFlags,
      evidence: [
        { claim: `${kw.keyword} 月搜索 ${kw.monthlySearchVolume}`, source: `keyword_metrics:${source.name}`, detail: `trend3m=${kw.trend3m}` },
        { claim: `低评论占比 ${comp.lowReviewShare}`, source: `competitor_snapshot:${source.name}`, detail: `brand=${comp.brandConcentration}` },
        { claim: `单件净利 ${cost.netProfitUsd}`, source: `landed_cost:${source.name}`, detail: `netMargin=${cost.netMargin}` },
        { claim: `合规 ${legal.certifications.join("/") || "无"}`, source: `compliance_check:${source.name}`, detail: legal.notes.join("；") },
      ],
    });
  }
  return out;
}

function writeTrace(caseId: string, trace: TraceEntry[]): string {
  const dir = path.join(EVAL_OUT, caseId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "trace.jsonl");
  writeFileSync(file, trace.map((row) => JSON.stringify({ at: new Date().toISOString(), ...row })).join("\n") + "\n");
  return file;
}

async function runPipeline(c: PipelineCase): Promise<CaseResult> {
  const trace: TraceEntry[] = [];
  const record = async <T>(tool: string, fn: () => Promise<T>): Promise<T> => {
    try {
      const value = await fn();
      trace.push({ tool, ok: true });
      return value;
    } catch (error) {
      trace.push({ tool, ok: false });
      throw error;
    }
  };

  clearLiveMarketplace();
  await record("set_marketplace", () => setMarketplace.execute({ marketplace: c.marketplace }));
  const searched = await record("search_products", () =>
    searchProducts.execute({ query: c.query, limit: 5 }),
  );
  if (searched.error || !searched.products?.length) {
    writeTrace(c.id, trace);
    return { id: c.id, ok: false, detail: `search 失败：${searched.error ?? "无商品"}` };
  }
  if (searched.currency !== c.expectCurrency) {
    writeTrace(c.id, trace);
    return { id: c.id, ok: false, detail: `期望货币 ${c.expectCurrency}，实际 ${searched.currency}` };
  }

  const demandPoints = c.marketplace === "DE" ? DEMAND_POINTS_DE : DEMAND_POINTS;
  const researched = await record("research_candidates", () => researchWithoutLlm(searched.products, demandPoints));
  if (researched.length === 0) {
    writeTrace(c.id, trace);
    return { id: c.id, ok: false, detail: "research 未收回候选" };
  }

  await record("score_and_save", async () => {
    const { ok, rejected } = validateCandidates(researched);
    const rows = rankCandidates(ok as Candidate[]);
    const report = buildReport(ok as Candidate[], {
      marketplace: c.marketplace,
      sourceIsMock: true,
      dataGaps: { rejected: rejected.map((r) => String(r.index)) },
    });
    const file = saveReport(report);
    if (!rows.length) throw new Error("打分后无行");
    return file;
  });

  const order = assertToolOrder(trace, c.expectOrder);
  const file = writeTrace(c.id, trace);
  if (!order.ok) return { id: c.id, ok: false, detail: `${order.reason}；trace→${file}` };
  return { id: c.id, ok: true, detail: `PASS trace→${file} products=${searched.count}` };
}

async function runGateSearch(c: GateSearchCase): Promise<CaseResult> {
  clearLiveMarketplace();
  const trace: TraceEntry[] = [];
  const result = await searchProducts.execute({ query: c.query, limit: 3 });
  trace.push({ tool: "search_products", ok: !result.error });
  writeTrace(c.id, trace);
  if (!result.error) {
    return { id: c.id, ok: false, detail: "未选站时 search 居然成功了（闸门失效）" };
  }
  if (result.products?.length) {
    return { id: c.id, ok: false, detail: "未选站时不应返回商品列表" };
  }
  return { id: c.id, ok: true, detail: `闸门生效：${result.error}` };
}

function runTraceUnit(c: TraceUnitCase): CaseResult {
  const matched = assertToolOrder(c.badTrace, c.expectOrder).ok;
  const ok = matched === c.expectMatch;
  return {
    id: c.id,
    ok,
    detail: ok
      ? `assert-trace 对坏序判定正确（match=${matched}）`
      : `期望 match=${c.expectMatch}，实际 match=${matched}`,
  };
}

function runScoreGaps(c: ScoreGapsCase): CaseResult {
  const candidate: Candidate = {
    id: "B0GAPTEST",
    title: "缺利润测试款",
    category: "test",
    marketplace: "DE",
    priceUsd: 12,
    metrics: { demand: 0.5, trend: 0.4, competition: 0.6, margin: null },
    monthlyProfitUsd: null,
    monthlyUnits: null,
    riskFlags: [],
    evidence: [
      { claim: "有需求", source: "keyword_metrics:eval", detail: "x" },
      { claim: "有竞品", source: "competitor_snapshot:eval", detail: "x" },
      { claim: "有合规", source: "compliance_check:eval", detail: "x" },
    ],
  };
  const scored = scoreCandidate(candidate);
  const hit = scored.gaps.includes(c.expectGap);
  return {
    id: c.id,
    ok: hit,
    detail: hit ? `gaps 含「${c.expectGap}」` : `gaps=${JSON.stringify(scored.gaps)}，缺少「${c.expectGap}」`,
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
      else if (item.kind === "gate-search") result = await runGateSearch(item);
      else if (item.kind === "trace-unit") result = runTraceUnit(item);
      else if (item.kind === "score-gaps") result = runScoreGaps(item);
      else result = { id: (item as CaseBase).id, ok: false, detail: `未知 kind` };
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
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
