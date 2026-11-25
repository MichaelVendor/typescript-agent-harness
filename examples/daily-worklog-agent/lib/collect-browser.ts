import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DayBundle } from "./schema.ts";
import { dayRange } from "./day-range.ts";

type Row = DayBundle["browser"][number];

const AUTO_PATHS = [
  "Library/Application Support/Google/Chrome/Default/History",
  "Library/Application Support/BraveSoftware/Brave-Browser/Default/History",
  "Library/Application Support/Microsoft Edge/Default/History",
  ".config/google-chrome/Default/History",
];

const WEBKIT_EPOCH_OFFSET_MS = 11644473600000;

function hostMatches(url: string, allowlist: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some((d) => {
    const dom = d.toLowerCase();
    return host === dom || host.endsWith(`.${dom}`);
  });
}

/** Keep only rows whose hostname equals or is a subdomain of an allowlisted domain. */
export function filterBrowserUrls<T extends { url: string }>(rows: T[], allowlist: string[]): T[] {
  return rows.filter((r) => hostMatches(r.url, allowlist));
}

function resolveDb(historyDb: string): string | undefined {
  if (historyDb !== "auto") return existsSync(historyDb) ? historyDb : undefined;
  return AUTO_PATHS.map((p) => path.join(os.homedir(), p)).find((p) => existsSync(p));
}

export function collectBrowser(opts: {
  historyDb: string;
  domainAllowlist: string[];
  date: string;
  timezone: string;
}): { browser: DayBundle["browser"]; gaps: string[] } {
  const db = resolveDb(opts.historyDb);
  if (!db) {
    return {
      browser: [],
      gaps: [`browser: history db not found (${opts.historyDb === "auto" ? "auto-detect failed" : opts.historyDb})`],
    };
  }
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "pipe" });
  } catch {
    return { browser: [], gaps: ["browser: sqlite3 cli missing"] };
  }

  // Browsers lock the live DB; query a copy.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "worklog-history-"));
  const copy = path.join(tmpDir, "History");
  try {
    copyFileSync(db, copy);
    const { start, end } = dayRange(opts.date, opts.timezone);
    const toWebkit = (d: Date) => (d.getTime() + WEBKIT_EPOCH_OFFSET_MS) * 1000;
    const sql =
      "select u.url as url, u.title as title, v.visit_time as t " +
      "from visits v join urls u on u.id = v.url " +
      `where v.visit_time >= ${toWebkit(start)} and v.visit_time < ${toWebkit(end)} ` +
      "order by v.visit_time;";
    const out = execFileSync("sqlite3", ["-readonly", "-json", copy, sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const raw = (out ? JSON.parse(out) : []) as Array<{ url: string; title: string | null; t: number }>;
    const rows: Row[] = raw.map((r) => ({
      url: r.url,
      title: r.title ?? "",
      visitTime: new Date(r.t / 1000 - WEBKIT_EPOCH_OFFSET_MS).toISOString(),
    }));
    return { browser: filterBrowserUrls(rows, opts.domainAllowlist), gaps: [] };
  } catch (err) {
    return { browser: [], gaps: [`browser: failed to read history: ${(err as Error).message.split("\n")[0]}`] };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
