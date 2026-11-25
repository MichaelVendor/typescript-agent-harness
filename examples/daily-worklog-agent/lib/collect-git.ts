import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { DayBundle } from "./schema.ts";
import { dayRange } from "./day-range.ts";

export function collectGit(
  repos: string[],
  date: string,
  timezone: string,
): { git: DayBundle["git"]; gaps: string[] } {
  const { start, end } = dayRange(date, timezone);
  const git: DayBundle["git"] = [];
  const gaps: string[] = [];

  for (const repo of repos) {
    if (!existsSync(repo)) {
      gaps.push(`git: repo not found: ${repo}`);
      continue;
    }
    let out: string;
    try {
      out = execFileSync(
        "git",
        [
          "-C", repo, "log", "--all",
          `--since=${start.toISOString()}`,
          `--until=${end.toISOString()}`,
          "--pretty=format:%H%x09%s",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      gaps.push(`git: failed to read ${repo}: ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    const commits = out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t");
        return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
      });
    if (commits.length > 0) git.push({ repo, commits });
  }
  return { git, gaps };
}
