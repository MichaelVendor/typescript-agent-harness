/**
 * 夜间日卡：采集 → bundle → `tah run --quiet`（模型写摘要）→ 本地落盘日卡。
 *
 *   pnpm run-daily [--date YYYY-MM-DD] [--config ./tah.worklog.json]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { collectBrowser } from "../lib/collect-browser.ts";
import { collectCursor } from "../lib/collect-cursor.ts";
import { collectGit } from "../lib/collect-git.ts";
import { composeBundle } from "../lib/compose.ts";
import { loadWorklogConfig } from "../lib/config.ts";
import { findApiKeys } from "../lib/env-keys.ts";
import { saveBundle, saveDayCard } from "../lib/save.ts";

const ROOT = path.join(import.meta.dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const configPath = path.resolve(arg("--config") ?? "tah.worklog.json");
const cfg = loadWorklogConfig(configPath);
const date =
  arg("--date") ?? new Intl.DateTimeFormat("en-CA", { timeZone: cfg.timezone }).format(new Date());

const git = collectGit(cfg.repos, date, cfg.timezone);
const cursor = collectCursor(cfg.cursor.projectsRoot, date, cfg.timezone);
const browser = collectBrowser({
  historyDb: cfg.browser.historyDb,
  domainAllowlist: cfg.browser.domainAllowlist,
  date,
  timezone: cfg.timezone,
});
const bundle = composeBundle({
  date,
  git: git.git,
  cursor: cursor.cursor,
  browser: browser.browser,
  gaps: [...git.gaps, ...cursor.gaps, ...browser.gaps],
});
const { jsonPath: bundlePath } = saveBundle(bundle);

const keys = findApiKeys(ROOT);
if (Object.keys(keys).length === 0) {
  console.error(
    "run-daily: no DEEPSEEK_API_KEY or OPENAI_API_KEY (env, example .env, or ancestor .env); bundle saved to",
    bundlePath,
  );
  process.exit(1);
}

const prompt =
  `读取 ${bundlePath}，只依据该 bundle 写 3–6 行中文日卡摘要，禁止编造 bundle 中没有的 commit、URL 或事项。` +
  "只输出摘要正文，不要调用 save_day_card，不要加标题或解释。";
const run = spawnSync("pnpm", ["exec", "tah", "run", "--quiet", prompt], {
  cwd: ROOT,
  env: { ...process.env, ...keys }, // tah 只读 cwd/.env；把祖先 .env 找到的 key 一并传入
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  maxBuffer: 16 * 1024 * 1024,
});
if (run.status !== 0) {
  console.error("run-daily: tah run failed", run.error?.message ?? `exit ${run.status}`);
  process.exit(1);
}
const summary = run.stdout.trim();
if (!summary) {
  console.error("run-daily: tah run returned an empty summary");
  process.exit(1);
}

try {
  const saved = saveDayCard(bundle, summary);
  console.log("ok", saved.mdPath);
} catch (err) {
  console.error("run-daily: save day card failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
