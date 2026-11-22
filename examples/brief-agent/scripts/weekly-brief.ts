/**
 * 读 out/subscriptions.json 里 enabled 订阅，各跑一轮简报并落盘。
 *
 *   pnpm weekly
 *   BRIEF_SOURCE=live pnpm weekly
 *
 * cron 例（每周一 9:00）：
 *   0 9 * * 1 cd /path/to/examples/brief-agent && BRIEF_SOURCE=live pnpm weekly >> out/weekly.log 2>&1
 */
import { runWeeklyBriefs } from "../lib/weekly-brief.ts";

const results = await runWeeklyBriefs();
for (const r of results) {
  if (r.ok) console.log("ok", r.subscriptionId, r.mdPath);
  else console.error("fail", r.subscriptionId, r.error);
}
if (results.length === 0) {
  console.log("no enabled subscriptions — use subscribe_targets or edit out/subscriptions.json");
}
const failed = results.filter((r) => !r.ok).length;
process.exitCode = failed > 0 ? 1 : 0;
