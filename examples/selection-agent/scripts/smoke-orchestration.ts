/**
 * 编排冒烟：不起模型，用假的 SessionService 代替子 Agent，
 * 验证"切批 → 并发 → 解析 → 校验 → 打分 → 落盘"这条链路是通的。
 *
 *   node --experimental-strip-types examples/selection-agent/scripts/smoke-orchestration.ts
 *
 * 假子 Agent 干的事和真的一样：调 mock 数据源 + 归一化，只是不走 LLM。
 * 这样可以确定：真正接上模型后，出问题的地方只会是"模型填的字段"，不会是编排。
 */
import { researchCandidates } from "../lib/research.ts";
import { buildReport, type DataGap } from "../lib/report.ts";
import { validateCandidates, type Candidate } from "../lib/schema.ts";
import { rankCandidates, toMarkdownTable } from "../lib/score.ts";
import { mockMarketSource } from "../lib/sources/mock.ts";
import { competitionScore, DEMAND_POINTS, marginScore, piecewise, trendScore, unitEstimate } from "../lib/normalize.ts";

type ResearchInput = { asin: string; title: string; category: string; marketplace: string; priceUsd: number };

/** 假的子 Agent：行为对齐 lib/subagent.ts 里的任务书，回一段「带代码块的 JSON」。 */
async function fakeChild(input: ResearchInput): Promise<string> {
  const [kw, comp, cost, legal] = await Promise.all([
    mockMarketSource.keywordMetrics(input.asin),
    mockMarketSource.competitorSnapshot(input.asin),
    mockMarketSource.landedCost(input.asin, { priceUsd: input.priceUsd }),
    mockMarketSource.complianceCheck(input.asin),
  ]);
  if (!kw || !comp || !cost || !legal) throw new Error(`mock 数据缺失：${input.asin}`);

  const units = unitEstimate(kw.monthlySearchVolume);

  const payload = {
    id: input.asin,
    title: input.title,
    category: input.category,
    marketplace: input.marketplace,
    priceUsd: input.priceUsd,
    metrics: {
      demand: round(piecewise(kw.monthlySearchVolume, DEMAND_POINTS)),
      trend: round(trendScore(kw.trend3m)),
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
      { claim: `${kw.keyword} 月搜索 ${kw.monthlySearchVolume}`, source: "keyword_metrics:mock:local-json", detail: `trend3m=${kw.trend3m}` },
      { claim: `Top10 低评论占比 ${comp.lowReviewShare}`, source: "competitor_snapshot:mock:local-json", detail: `brandConcentration=${comp.brandConcentration}` },
      { claim: `单件净利 ${cost.netProfitUsd}`, source: "landed_cost:mock:local-json", detail: `netMargin=${cost.netMargin}` },
      { claim: `合规：${legal.certifications.join("/") || "无强制认证"}`, source: "compliance_check:mock:local-json", detail: legal.notes.join("；") },
    ],
  };
  // 故意加一句散文和一个代码块：真模型就是这样回的，解析必须扛得住。
  return `我按 asin 查了四个工具，结果如下：\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** 只实现 researchCandidates 用到的那一小块 SessionService，类型上按结构对齐。 */
function fakeSessions(failing: Set<string>) {
  let created = 0;
  return {
    created: () => created,
    service: {
      async create() {
        created += 1;
        const id = `child-${created}`;
        let input: ResearchInput | undefined;
        return {
          id,
          async run(task: string) {
            input = parseInput(task);
            if (failing.has(input.asin)) throw new Error(`模拟子 Agent 超时：${input.asin}`);
            return { text: await fakeChild(input), finishReason: "stop" };
          },
        };
      },
    },
  };
}

function parseInput(task: string): ResearchInput {
  const line = task.split("\n").find((l) => l.includes("asin="));
  if (!line) throw new Error("任务文本里没有候选信息");
  const asin = /asin=(\S+)/.exec(line)?.[1] ?? "";
  const category = /category=(\S+)/.exec(line)?.[1] ?? "";
  const marketplace = /marketplace=(\S+)/.exec(line)?.[1] ?? "";
  const priceUsd = Number(/priceUsd=([\d.]+)/.exec(line)?.[1] ?? "0");
  const title = task.split("\n").find((l) => l.startsWith("候选："))?.replace("候选：", "") ?? asin;
  return { asin, title, category, marketplace, priceUsd };
}

const products = await mockMarketSource.searchProducts({ limit: 50 });
// 模拟一个候选取证失败：报告里必须把它单列，而不是悄悄消失。
const failing = new Set([products[5]!.asin]);
const fake = fakeSessions(failing);

const outcome = await researchCandidates(
  {
    runtime: {
      get: (() => fake.service) as never,
      tryGet: (() => undefined) as never,
      emit: async () => undefined,
    },
  },
  {
    candidates: products,
    concurrency: 3,
    signal: new AbortController().signal,
    onBatchDone: ({ batch, ok, failed }) => console.log(`  批次 ${batch}：成功 ${ok}，失败 ${failed}`),
  },
);

console.log(`\n候选 ${products.length} 个 → 批次 ${outcome.batches} 个 → 子 Agent ${fake.created()} 个`);
console.log(`收回 ${outcome.candidates.length} 个，失败 ${outcome.failures.length} 个：${outcome.failures.map((f) => `${f.asin}(${f.stage})`).join(", ") || "—"}`);

const { ok, rejected } = validateCandidates(outcome.candidates);
const rows = rankCandidates(ok as Candidate[]);
const dataGaps: DataGap = { rejected: rejected.map((r) => String((outcome.candidates[r.index] as { id?: string })?.id ?? r.index)), knownFailures: outcome.failures };
const report = buildReport(ok as Candidate[], {
  marketplace: "US",
  sourceIsMock: true,
  dataGaps,
});

console.log(`\n${toMarkdownTable(rows)}`);
console.log(`\n通过校验 ${ok.length} 个，被挡下 ${rejected.length} 个，取证失败 ${outcome.failures.length} 个。`);
console.log(`榜单第一名：${rows[0]?.id} ${rows[0]?.total} ${rows[0]?.action}`);
console.log(`报告对象已构建（未落盘，避免冒烟污染 out/）：generatedAt=${report.generatedAt}`);

if (rows.length !== products.length - failing.size) {
  console.error("期望的候选数量与实测不符");
  process.exit(1);
}
if (dataGaps.knownFailures?.length !== 1) {
  console.error("取证失败的候选没有进 dataGaps");
  process.exit(1);
}
