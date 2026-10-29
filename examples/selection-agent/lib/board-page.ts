import { WEIGHTS } from "./score.ts";

export type BoardRow = {
  id: string;
  title: string;
  total: number;
  action: string;
  riskFlags?: string[];
  breakdown?: { demand?: number; trend?: number; competition?: number; margin?: number };
  gaps?: string[];
};

const DIMS = [
  { key: "demand", label: "需求", gap: "需求（无月搜索量）", scale: WEIGHTS.demand },
  { key: "trend", label: "趋势", gap: "趋势（无近 3 个月搜索序列）", scale: WEIGHTS.trend },
  { key: "competition", label: "竞争", gap: "竞争", scale: WEIGHTS.competition },
  { key: "margin", label: "利润", gap: "利润（无采购成本）", scale: WEIGHTS.margin },
] as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function linesOf(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)、]\s*/, "").trim())
    .filter(Boolean);
}

function noteOf(line: string): { title: string; why: string; check: string } {
  const mark = line.search(/要验/);
  if (mark < 0) return { title: line, why: "", check: "" };
  const head = line.slice(0, mark).replace(/[；;]\s*$/, "").trim();
  const check = line.slice(mark).replace(/^要验证的是\s*/, "").replace(/^要验[证：:\s]*/, "").trim();
  const colon = head.search(/[：:]/);
  if (colon > 0 && colon <= 80) {
    return { title: head.slice(0, colon).trim(), why: head.slice(colon + 1).trim(), check };
  }
  return { title: "", why: head, check };
}

/** 看板上的那一句结论，只用报告里的建议动作计数。 */
export function boardCaption(rows: { action: string }[]): string {
  const counts = { 上架: 0, 观察: 0, 放弃: 0 };
  for (const row of rows) {
    if (row.action === "上架" || row.action === "观察" || row.action === "放弃") counts[row.action] += 1;
  }
  return `${rows.length} 条里 ${counts.上架} 条建议上架，${counts.观察} 条观察，${counts.放弃} 条放弃。`;
}

function barWidth(value: number, scale: number, raw: boolean): number {
  const full = raw || scale <= 0 ? 1 : scale;
  return Math.max(0, Math.min(100, (value / full) * 100));
}

/** 选品结果的单页。数字来自报告，结论和说明只是带上的文字。 */
export function boardPage(input: {
  conclusion?: string;
  notes?: string;
  gaps?: string;
  rows: BoardRow[];
  images?: Readonly<Record<string, string>>;
  siteLabel?: string;
}): { html: string; height: number } {
  const notes = linesOf(input.notes).map(noteOf);
  const gaps = linesOf(input.gaps);
  const raw = input.rows.some((row) =>
    DIMS.some((dim) => {
      const value = row.breakdown?.[dim.key];
      return typeof value === "number" && value > dim.scale && !row.gaps?.includes(dim.gap);
    }),
  );
  const counts = { 上架: 0, 观察: 0, 放弃: 0 };
  for (const row of input.rows) {
    if (row.action === "上架" || row.action === "观察" || row.action === "放弃") counts[row.action] += 1;
  }
  const actionTone = (action: string) =>
    action === "上架" ? "ok" : action === "观察" ? "warn" : action === "放弃" ? "drop" : "neutral";
  const stats = (["上架", "观察", "放弃"] as const)
    .map(
      (action) =>
        `<div class="stat ${actionTone(action)}"><b>${counts[action]}</b><span>${action}</span></div>`,
    )
    .join("");

  const rowsHtml = input.rows
    .map((row, index) => {
      const image = input.images?.[row.id];
      const photo = image
        ? `<img class="thumb" src="${escapeHtml(image)}" alt="" />`
        : `<span class="thumb photo"></span>`;
      const dims = DIMS.map((dim) => {
        const missing = row.gaps?.includes(dim.gap) ?? false;
        const value = row.breakdown?.[dim.key];
        const shown = !missing && typeof value === "number";
        const width = shown ? barWidth(value, dim.scale, raw) : 0;
        const num = shown ? value.toFixed(3) : "—";
        return `<td class="col-dim"><div class="dim"><span>${dim.label}<em>${num}</em></span><span class="track"><i style="width:${width.toFixed(1)}%"></i></span></div></td>`;
      }).join("");
      const risk = row.riskFlags?.length
        ? `<span class="risk">${escapeHtml(row.riskFlags.join("、"))}</span>`
        : "";
      const shelf = row.action === "上架" ? " shelf" : "";
      return `<tr class="${escapeHtml(actionTone(row.action))}${shelf}">
        <td class="col-rank">${index + 1}</td>
        <td class="col-img">${photo}</td>
        <td class="col-title"><p class="title">${escapeHtml(row.title)}</p><p class="asin">${escapeHtml(row.id)}</p>${risk}</td>
        <td class="col-action"><span class="pill ${actionTone(row.action)}">${escapeHtml(row.action)}</span></td>
        <td class="col-score"><span class="score">${row.total.toFixed(3)}</span></td>
        ${dims}
      </tr>`;
    })
    .join("");

  const meta = input.siteLabel?.trim()
    ? `<div class="meta"><div class="site">${escapeHtml(input.siteLabel.trim())}</div><div class="stamp">选品结果</div></div>`
    : "";
  const conclusion = input.conclusion?.trim()
    ? `<p class="lead">${escapeHtml(input.conclusion.trim())}</p>`
    : "";
  const hero = input.conclusion?.trim()
    ? `<div class="hero">${conclusion}<div class="stats">${stats}</div></div>`
    : `<div class="stats-wrap"><div class="stats">${stats}</div></div>`;

  const rankPanel = `<div class="panel">
  <div class="label">排行对比</div>
  <table class="rank">
    <thead>
      <tr>
        <th class="col-rank">#</th>
        <th class="col-img"></th>
        <th class="col-title">商品</th>
        <th class="col-action">动作</th>
        <th class="col-score">总分</th>
        <th class="col-dim">需求</th>
        <th class="col-dim">趋势</th>
        <th class="col-dim">竞争</th>
        <th class="col-dim">利润</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</div>`;

  const noteBlock = notes.length
    ? `<div class="panel"><div class="label">说明</div><div class="notes">${notes
        .map(
          (note) => `<div class="note">
            ${note.title ? `<h3>${escapeHtml(note.title)}</h3>` : ""}
            ${note.why ? `<p><b>为什么</b>${escapeHtml(note.why)}</p>` : ""}
            ${note.check ? `<p><b>要验</b>${escapeHtml(note.check)}</p>` : ""}
          </div>`,
        )
        .join("")}</div></div>`
    : "";
  const gapBlock = gaps.length
    ? `<div class="panel"><div class="label">缺口</div><div class="gaps">${gaps.map((gap) => `<span class="gap">${escapeHtml(gap)}</span>`).join("")}</div></div>`
    : "";

  const html = `<!doctype html>
<html lang="zh">
<meta charset="utf-8" />
<title>选品结果</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #e8ecf1; color: #121820; font: 14px/1.45 "PingFang SC", "Noto Sans SC", "Segoe UI", system-ui, sans-serif; }
  main { width: 840px; margin: 0 auto; padding: 22px 20px 28px; }
  .meta { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  .meta .site { font-size: 12px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: #0c5c6b; }
  .meta .stamp { font-size: 12px; color: #5c6b7a; }
  .hero { display: grid; grid-template-columns: 1.4fr 1fr; gap: 10px; margin-bottom: 14px; }
  .stats-wrap { margin-bottom: 14px; }
  .lead, .stats { background: #f7f9fb; border: 1px solid #d5dde6; border-radius: 8px; }
  .lead { margin: 0; padding: 16px 18px; font-size: 17px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.35; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); padding: 10px 6px; }
  .stat { text-align: center; border-right: 1px solid #d5dde6; }
  .stat:last-child { border-right: 0; }
  .stat b { display: block; font-size: 26px; line-height: 1; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; color: #5c6b7a; }
  .stat.ok b { color: #0f6b3c; }
  .stat.warn b { color: #8a5b00; }
  .stat.drop b { color: #6b7280; }
  .panel { background: #f7f9fb; border: 1px solid #d5dde6; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
  .panel > .label { padding: 10px 14px 8px; font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: #5c6b7a; border-bottom: 1px solid #d5dde6; background: #f3f6f9; }
  table.rank { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.rank th { padding: 8px 10px; font-size: 11px; font-weight: 650; color: #5c6b7a; text-align: left; border-bottom: 1px solid #d5dde6; background: #fbfcfd; }
  table.rank td { padding: 12px 10px; vertical-align: middle; border-bottom: 1px solid #e6ebf0; font-size: 13px; }
  table.rank tr:last-child td { border-bottom: 0; }
  table.rank tr.shelf { background: #f3faf6; }
  .col-rank { width: 36px; color: #5c6b7a; font-variant-numeric: tabular-nums; }
  .col-img { width: 56px; }
  .col-action { width: 64px; }
  .col-score { width: 72px; }
  .col-dim { width: 88px; }
  .thumb { width: 44px; height: 44px; border-radius: 6px; object-fit: contain; background: #dfe6ec; border: 1px solid #d5dde6; display: block; }
  .thumb.photo { background: linear-gradient(145deg, #dfe6ec, #c9d4de); }
  .title { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.35; }
  .asin { margin: 3px 0 0; font-size: 11px; color: #5c6b7a; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
  .pill.ok { background: #e5f5ec; color: #0f6b3c; }
  .pill.warn { background: #f8f0d8; color: #8a5b00; }
  .pill.drop { background: #eef1f4; color: #6b7280; }
  .pill.neutral { background: #eef2f6; color: #5c6b7a; }
  .score { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .dim { display: grid; gap: 3px; }
  .dim span { font-size: 10px; color: #5c6b7a; display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
  .dim em { font-style: normal; }
  .track { height: 6px; border-radius: 99px; background: #dfe6ec; overflow: hidden; display: block; }
  .track i { display: block; height: 100%; background: #1a6f7c; border-radius: 99px; }
  .risk { display: inline-block; margin-top: 4px; padding: 2px 6px; border-radius: 4px; background: #f8f0d8; color: #8a5b00; font-size: 11px; }
  .notes { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .note { padding: 12px 14px; border-right: 1px solid #d5dde6; border-bottom: 1px solid #d5dde6; }
  .note:nth-child(2n) { border-right: 0; }
  .note h3 { margin: 0 0 6px; font-size: 13px; }
  .note p { margin: 0 0 4px; font-size: 12px; color: #334155; }
  .note b { display: inline-block; min-width: 36px; color: #5c6b7a; font-weight: 650; font-size: 11px; }
  .gaps { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px 14px; }
  .gap { padding: 4px 10px; border-radius: 4px; background: #eef2f6; border: 1px solid #d5dde6; font-size: 12px; color: #334155; }
</style>
<main>
  ${meta}
  ${hero}
  ${rankPanel}
  ${noteBlock}
  ${gapBlock}
</main>
</html>
`;
  const rowsHeight = input.rows.reduce(
    (sum, row) => sum + 72 + Math.ceil(row.title.length / 26) * 16,
    0,
  );
  const height =
    180 +
    (input.siteLabel?.trim() ? 28 : 0) +
    (input.conclusion?.trim() ? 72 : 48) +
    rowsHeight +
    (notes.length ? 48 + Math.ceil(notes.length / 2) * 72 : 0) +
    (gaps.length ? 64 : 0);
  return { html, height: Math.max(720, Math.min(height, 12000)) };
}
