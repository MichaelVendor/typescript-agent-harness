import { readFileSync } from "node:fs";
import path from "node:path";

export function loadDotEnv(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // `KEY=` means unset, so the blank DEEPSEEK_API_KEY= in .env.example does not shadow OPENAI_API_KEY.
    if (value !== "" && process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadCliEnv(cwd: string): void {
  loadDotEnv(path.join(cwd, ".env"));
  loadDotEnv(path.join(cwd, "examples/basic-agent/.env"));
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY);
}
