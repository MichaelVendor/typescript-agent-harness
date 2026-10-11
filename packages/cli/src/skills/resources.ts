import { existsSync } from "node:fs";
import path from "node:path";

const BARE_REF_RE = /\b(?:\.\/)?[\w.\/-]+\.(?:md|sh|ts|js|py|json)\b/g;
const BACKTICK_REF_RE = new RegExp("`([^`]+)`", "g");

function isUnderDir(resolved: string, dir: string): boolean {
  if (resolved === dir) return true;
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return resolved.startsWith(prefix);
}

function normalizeRel(dir: string, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const resolved = path.resolve(dir, trimmed);
  if (!isUnderDir(resolved, dir)) return null;
  if (!existsSync(resolved)) return null;
  const rel = path.relative(dir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

export function listSkillResources(dir: string, body: string): Array<{ path: string }> {
  const seen = new Set<string>();
  const paths: string[] = [];

  const add = (raw: string) => {
    const rel = normalizeRel(dir, raw);
    if (rel && !seen.has(rel)) {
      seen.add(rel);
      paths.push(rel);
    }
  };

  for (const m of body.matchAll(BARE_REF_RE)) {
    add(m[0]!);
  }
  for (const m of body.matchAll(BACKTICK_REF_RE)) {
    add(m[1]!);
  }

  return paths.map((p) => ({ path: p }));
}
