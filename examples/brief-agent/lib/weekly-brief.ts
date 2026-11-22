import { composeBrief } from "./compose.ts";
import { extractSignalsForPages } from "./extract.ts";
import { fetchProductPages } from "./fetch.ts";
import { notifyBrief, type NotifyDeps } from "./notify.ts";
import { saveBrief, setBriefOutDirForTest } from "./save.ts";
import { validateBrief } from "./schema.ts";
import {
  listEnabledSubscriptions,
  type WeeklyRunResult,
} from "./subscriptions.ts";
import { resolveTargets } from "./targets.ts";

export type RunWeeklyBriefsOpts = {
  /** 覆盖订阅文件路径。 */
  subscriptionsPath?: string;
  /** 测试用 brief 落盘目录。 */
  briefsDir?: string | null;
  now?: Date;
  notify?: NotifyDeps;
  /** false 时跳过推送（默认 true）。 */
  notifyEnabled?: boolean;
};

/** 跑所有 enabled 订阅：各出一份 brief 并 save（含 tasks）。 */
export async function runWeeklyBriefs(
  opts?: RunWeeklyBriefsOpts,
): Promise<WeeklyRunResult[]> {
  if (opts?.briefsDir !== undefined) {
    setBriefOutDirForTest(opts.briefsDir);
  }
  try {
    const subs = listEnabledSubscriptions(opts?.subscriptionsPath);
    const results: WeeklyRunResult[] = [];
    for (const sub of subs) {
      try {
        const resolved = resolveTargets({ targets: sub.targets });
        const fetched = await fetchProductPages({ targets: resolved.targets });
        const extracted = await extractSignalsForPages(fetched.pages);
        const brief = composeBrief({
          market: "DE",
          signals: extracted.signals,
          failures: [...fetched.failures, ...extracted.failures],
          truncated: resolved.truncated,
          template: sub.template,
        });
        const problems = validateBrief(brief);
        if (problems.length) {
          results.push({
            subscriptionId: sub.id,
            ok: false,
            error: problems.map((p) => p.message).join("; "),
            brief,
          });
          continue;
        }
        const saved = opts?.now ? saveBrief(brief, { now: opts.now }) : saveBrief(brief);
        let notify: WeeklyRunResult["notify"];
        if (opts?.notifyEnabled !== false) {
          notify = await notifyBrief(
            {
              subscriptionId: sub.id,
              markdown: brief.markdown,
              mdPath: saved.mdPath,
            },
            opts?.notify,
          );
        }
        results.push({
          subscriptionId: sub.id,
          ok: true,
          mdPath: saved.mdPath,
          jsonPath: saved.jsonPath,
          brief,
          ...(notify && notify.length > 0 ? { notify } : {}),
        });
      } catch (error) {
        results.push({
          subscriptionId: sub.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  } finally {
    if (opts?.briefsDir !== undefined) {
      setBriefOutDirForTest(null);
    }
  }
}
