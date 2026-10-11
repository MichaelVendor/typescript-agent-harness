import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseSkillMarkdown } from "./parse.js";
import type { SkillSource, SkillSummary } from "./types.js";

export type DiscoverSkillsOpts = {
  cwd: string;
  isProject: boolean;
  homeDir: string;
};

type RootSpec = { root: string; source: SkillSource; label: string };

function skillRoots(opts: DiscoverSkillsOpts): RootSpec[] {
  const { cwd, isProject, homeDir } = opts;
  const roots: RootSpec[] = [
    { root: path.join(homeDir, ".tah", "skills"), source: "home", label: ".tah/skills" },
  ];
  if (isProject) {
    roots.push(
      { root: path.join(cwd, ".cursor", "skills"), source: "cursor", label: ".cursor/skills" },
      { root: path.join(cwd, ".agents", "skills"), source: "agents", label: ".agents/skills" },
      { root: path.join(cwd, "skills"), source: "skills", label: "skills" },
    );
  }
  return roots;
}

function ingestFile(
  map: Map<string, SkillSummary>,
  warnings: string[],
  skillFile: string,
  expectedName: string,
  dir: string,
  source: SkillSource,
  warnPrefix: string,
): void {
  let raw: string;
  try {
    raw = readFileSync(skillFile, "utf8");
  } catch {
    warnings.push(`${warnPrefix}: cannot read ${skillFile}`);
    return;
  }
  const parsed = parseSkillMarkdown(raw, expectedName);
  if (!parsed.ok) {
    warnings.push(`${warnPrefix}: ${parsed.warning}`);
    return;
  }
  map.set(parsed.meta.name, {
    name: parsed.meta.name,
    description: parsed.meta.description,
    modelInvocable: parsed.meta.modelInvocable,
    userInvocable: parsed.meta.userInvocable,
    dir,
    skillFile: path.resolve(skillFile),
    source,
  });
}

function scanRoot(map: Map<string, SkillSummary>, warnings: string[], spec: RootSpec, cwd: string): void {
  const { root, source, label } = spec;
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    warnings.push(`${label}: cannot read directory`);
    return;
  }

  for (const entry of entries) {
    const full = path.join(root, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }

    if (st.isDirectory()) {
      const skillFile = path.join(full, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const rel = path.relative(cwd, full).split(path.sep).join("/");
      ingestFile(map, warnings, skillFile, entry, path.resolve(full), source, rel);
      continue;
    }

    if (st.isFile() && entry.endsWith(".md") && entry !== "SKILL.md") {
      const expectedName = entry.slice(0, -3);
      const rel = path.relative(cwd, full).split(path.sep).join("/");
      ingestFile(map, warnings, full, expectedName, path.resolve(root), source, rel.replace(/\/[^/]+$/, "") || rel);
    }
  }
}

export function discoverSkills(opts: DiscoverSkillsOpts): { skills: SkillSummary[]; warnings: string[] } {
  const map = new Map<string, SkillSummary>();
  const warnings: string[] = [];
  for (const spec of skillRoots(opts)) {
    scanRoot(map, warnings, spec, opts.cwd);
  }
  const skills = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { skills, warnings };
}
