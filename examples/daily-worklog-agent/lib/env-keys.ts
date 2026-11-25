import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const KEYS = ["DEEPSEEK_API_KEY", "OPENAI_API_KEY"] as const;

function parseKeys(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = /^\s*(?:export\s+)?(DEEPSEEK_API_KEY|OPENAI_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").replace(/^(["'])(.*)\1$/, "$2");
    if (key && value) out[key] = value;
  }
  return out;
}

/**
 * LLM key 查找：进程环境 → startDir/.env → 逐级祖先 .env（止于仓库根或文件系统根）。
 * 先找到者优先；返回找到的键值，供子进程注入。
 */
export function findApiKeys(startDir: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const found: Record<string, string> = {};
  for (const k of KEYS) if (env[k]) found[k] = env[k] as string;

  let dir = path.resolve(startDir);
  for (;;) {
    const file = path.join(dir, ".env");
    if (existsSync(file)) {
      for (const [k, v] of Object.entries(parseKeys(readFileSync(file, "utf8")))) {
        if (!(k in found)) found[k] = v;
      }
    }
    const atRepoRoot = existsSync(path.join(dir, ".git")) || existsSync(path.join(dir, "pnpm-workspace.yaml"));
    const parent = path.dirname(dir);
    if (atRepoRoot || parent === dir) break;
    dir = parent;
  }
  return found;
}
