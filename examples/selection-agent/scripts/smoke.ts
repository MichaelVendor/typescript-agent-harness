/**
 * 冒烟脚本：用 mock 数据把 12 个候选跑完整条链路（取数 → 归一化 → 打分 → 落盘），
 * 证明"工具层能取到数、规则层能算分、报告能落盘"。不进 tools/，不会被当成工具加载。
 *
 *   node --experimental-strip-types examples/selection-agent/scripts/smoke.ts
 */
import { buildReport, saveReport } from "../lib/report.ts";
import { validateCandidates, type Candidate } from "../lib/schema.ts";
import { mockMarketSource } from "../lib/sources/mock.ts";
import { competitionScore, marginScore, piecewise, DEMAND_POINTS, trendScore } from "../lib/normalize.ts";
import { toMarkdownTable } from "../lib/score.ts";

const products = await mockMarketSource.searchProducts({ limit: 50 });
const candidates: Candidate[] = [];
const skipped: string[] = [];

for (const p of products) {
  const [kw, comp, cost, legal] = await Promise.all([
    mockMarketSource.keywordMetrics(p.asin),
    mockMarketSource.competitorSnapshot(p.asin),
    mockMarketSource.landedCost(p.asin, { priceUsd: p.priceUsd }),
    mockMarketSource.complianceCheck(p.asin),
  ]);
  if (!kw || !comp || !cost || !legal) {
    skipped.push(p.asin);
    continue;
  }
  candidates.push({
    id: p.asin,
    title: p.title,
    category: p.category,
    marketplace: p.marketplace,
    priceUsd: p.priceUsd,
    metrics: {
      demand: piecewise(kw.monthlySearchVolume, DEMAND_POINTS),
      trend: trendScore(kw.trend3m),
      competition: competitionScore(comp.lowReviewShare, comp.brandConcentration),
      margin: marginScore(cost.netMargin),
    },
    monthlyProfitUsd: {
      low: Math.round(cost.netProfitUsd * 0.9 * kw.monthlySearchVolume * 0.015),
      mid: Math.round(cost.netProfitUsd * kw.monthlySearchVolume * 0.03),
      high: Math.round(cost.netProfitUsd * 1.1 * kw.monthlySearchVolume * 0.05),
    },
    monthlyUnits: {
      low: Math.round(kw.monthlySearchVolume * 0.015),
      mid: Math.round(kw.monthlySearchVolume * 0.03),
      high: Math.round(kw.monthlySearchVolume * 0.05),
    },
    riskFlags: legal.riskFlags as Candidate["riskFlags"],
    evidence: [
      { claim: `${kw.keyword} 月搜索 ${kw.monthlySearchVolume}`, source: "keyword_metrics:mock", detail: `trend3m=${kw.trend3m}` },
      { claim: `Top10 低评论占比 ${comp.lowReviewShare}`, source: "competitor_snapshot:mock", detail: `brandConcentration=${comp.brandConcentration}` },
      { claim: `单件净利 ${cost.netProfitUsd}`, source: "landed_cost:mock", detail: `netMargin=${cost.netMargin}` },
      { claim: `合规：${legal.certifications.join("/") || "无强制认证"}`, source: "compliance_check:mock", detail: legal.notes.join("；") },
    ],
  });
}

const { ok, rejected } = validateCandidates(candidates);
if (rejected.length) {
  console.error("校验失败：", JSON.stringify(rejected, null, 2));
  process.exit(1);
}

const report = buildReport(ok, { marketplace: "US", sourceIsMock: true });
const file = saveReport(report);

console.log(report.markdown);
console.log(`\n候选 ${report.candidates} 个，跳过 ${skipped.length} 个（${skipped.join(", ") || "—"}）`);
console.log(`报告：${file}`);
