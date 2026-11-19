/**
 * 冒烟脚本：用 mock 数据把 3 个竞品跑完整条链路
 * （resolve → fetch → extract → compose → save），
 * 证明工具层能取到数、规则层能出 schema、简报能落盘。不进 tools/，不会被当成工具加载。
 *
 *   pnpm smoke
 *   node --experimental-strip-types scripts/smoke.ts
 */
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
