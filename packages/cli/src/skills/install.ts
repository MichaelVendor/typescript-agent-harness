import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { parseSkillMarkdown } from "./parse.js";
import { SKILL_NAME_RE } from "./types.js";

const homeSkills = (homeDir: string) => path.join(homeDir, ".tah", "skills");

const isSkillDir = (dir: string) => {
  try {
    return statSync(dir).isDirectory() && existsSync(path.join(dir, "SKILL.md"));
  } catch {
    return false;
  }
};

/**
 * Copies one skill folder (it has a SKILL.md) into `~/.tah/skills`, or every skill folder directly
 * inside `from` (e.g. `~/.cursor/skills`). Names already installed are skipped, never overwritten.
 * Symlinked skills are copied as files, since a relative link would break in the new place.
 */
export function importSkills(homeDir: string, from: string): { imported: string[]; skipped: string[] } {
  const src = path.resolve(from);
  const dirs = isSkillDir(src)
    ? [src]
    : readdirSync(src)
        .map((entry) => path.join(src, entry))
        .filter(isSkillDir);
  if (dirs.length === 0) throw new Error(`no SKILL.md in ${src} or the folders directly inside it`);
  const root = homeSkills(homeDir);
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const dir of dirs) {
    const name = path.basename(dir);
    const parsed = parseSkillMarkdown(readFileSync(path.join(dir, "SKILL.md"), "utf8"), name);
    if (!parsed.ok) {
      skipped.push(`${name}: ${parsed.warning}`);
      continue;
    }
    const dest = path.join(root, name);
    if (existsSync(dest) || existsSync(`${dest}.md`)) {
      skipped.push(`${name}: already installed`);
      continue;
    }
    cpSync(dir, dest, { recursive: true, dereference: true });
    imported.push(name);
  }
  return { imported, skipped };
}

/** Removes a skill from `~/.tah/skills` (folder or flat `<name>.md`). Skills inside a work folder are left alone. */
export function removeSkill(homeDir: string, name: string): void {
  if (!SKILL_NAME_RE.test(name)) throw new Error(`invalid skill name: ${name}`);
  const dir = path.join(homeSkills(homeDir), name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  else if (existsSync(`${dir}.md`)) rmSync(`${dir}.md`);
  else throw new Error(`no skill "${name}" in ~/.tah/skills`);
}
