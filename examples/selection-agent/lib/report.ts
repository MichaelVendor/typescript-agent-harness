/**
 * 报告落盘：报告存 <项目根>/out/reports/<时间戳>.json。
 *
 * 只写文件，不引数据库——MVP 阶段需要的是"能复算"，
 * 一次运行一个 JSON 就够；要查询再上 SQLite，格式不用变。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadListingImages } from "./listing-images.ts";
import { rankCandidates, toMarkdownTable, WEIGHTS, type Scored, type Weights } from "./score.ts";
import type { Candidate } from "./schema.ts";

/** 取证失败或被校验挡下的候选：报告里单列，避免"没上榜"被误读成"分低"。 */
export type DataGap = {
  rejected?: string[];
  /** 来自 research_candidates 的 failures，原样带上来做复盘。 */
  knownFailures?: { asin: string; stage: string; reason: string }[];
};

export type Report = {
  generatedAt: string;
  marketplace: string;
  sourceIsMock: boolean;
  weights: Weights;
  candidates: number;
  rows: Scored[];
  markdown: string;
  dataGaps?: DataGap;
};

export function buildReport(
  candidates: Candidate[],
  meta: {
    marketplace: string;
    sourceIsMock: boolean;
    weights?: Weights;
    now?: Date;
    dataGaps?: DataGap;
    images?: Readonly<Record<string, string>>;
  },
): Report {
  const rows = rankCandidates(candidates, meta.weights);
  const gaps = meta.dataGaps;
  const hasGaps = Boolean(gaps && ((gaps.rejected?.length ?? 0) > 0 || (gaps.knownFailures?.length ?? 0) > 0));
  return {
    generatedAt: (meta.now ?? new Date()).toISOString(),
    marketplace: meta.marketplace,
    sourceIsMock: meta.sourceIsMock,
    weights: meta.weights ?? WEIGHTS,
    candidates: candidates.length,
    rows,
    markdown: toMarkdownTable(rows, meta.images ?? loadListingImages()),
    ...(hasGaps ? { dataGaps: gaps } : {}),
  };
}

/** 项目根目录：报告和日志都落在 <root>/out 下，和启动时的 cwd 解耦。lib/ 的上一级即项目根。 */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

function reportStamp(iso: string): string {
  // ISO 里的 : 和 . 在 Windows 文件名中非法，统一换成 -；保留毫秒避免同名覆盖。
  return iso.replaceAll(":", "-").replaceAll(".", "-");
}

/** 文件名带毫秒时间戳，同一次运行重跑不会互相覆盖。 */
export function saveReport(report: Report, root: string = PROJECT_ROOT): string {
  const dir = path.join(root, "out", "reports");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${reportStamp(report.generatedAt)}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}
