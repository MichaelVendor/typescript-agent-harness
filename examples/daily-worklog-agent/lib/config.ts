import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorklogConfig } from "./schema.ts";

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function loadWorklogConfig(configPath: string): WorklogConfig {
  if (!existsSync(configPath)) {
    throw new Error(`worklog config not found: ${configPath}`);
  }
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as WorklogConfig;
  return {
    ...raw,
    repos: raw.repos.map(expandTilde),
    cursor: {
      ...raw.cursor,
      projectsRoot: expandTilde(raw.cursor.projectsRoot),
    },
  };
}