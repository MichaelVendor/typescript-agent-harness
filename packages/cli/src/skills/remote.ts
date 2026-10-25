import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importSkillsFrom } from "./install.js";

export type SkillSource =
  | { kind: "local"; root: string; subpath: string }
  | { kind: "git"; url: string; subpath: string; ref?: string };

const isSkillDir = (dir: string) => {
  try {
    return statSync(dir).isDirectory() && existsSync(path.join(dir, "SKILL.md"));
  } catch {
    return false;
  }
};

const directSkillDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir)
      .map((entry) => path.join(dir, entry))
      .filter(isSkillDir);
  } catch {
    return [];
  }
};

/** Claude-style marketplace: plugins[].skills are paths relative to the repo root. */
const marketplaceSkillDirs = (repo: string): string[] => {
  const file = path.join(repo, ".claude-plugin", "marketplace.json");
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      plugins?: { skills?: unknown }[];
    };
    const out: string[] = [];
    for (const plugin of raw.plugins ?? []) {
      const listed = Array.isArray(plugin.skills) ? plugin.skills : [];
      for (const entry of listed) {
        if (typeof entry !== "string" || !entry.trim()) continue;
        const abs = path.resolve(repo, entry);
        const rel = path.relative(path.resolve(repo), abs);
        if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
        if (isSkillDir(abs)) out.push(abs);
      }
    }
    return out;
  } catch {
    return [];
  }
};

/**
 * Skill folders under `root`: the folder itself, its direct children, `skills/` children,
 * or paths listed in `.claude-plugin/marketplace.json`.
 */
export function findSkillDirs(root: string): string[] {
  const abs = path.resolve(root);
  if (isSkillDir(abs)) return [abs];
  const kids = directSkillDirs(abs);
  if (kids.length) return kids;
  const nested = path.join(abs, "skills");
  if (existsSync(nested)) {
    const under = directSkillDirs(nested);
    if (under.length) return under;
  }
  const fromMarket = marketplaceSkillDirs(abs);
  if (fromMarket.length) return fromMarket;
  throw new Error(`no SKILL.md in ${abs} or the folders directly inside it`);
}

/**
 * `./path`, `/abs`, `owner/repo`, `owner/repo/sub#ref`, https/git URLs.
 * Bare `owner/repo` means GitHub.
 */
export function parseSkillSource(spec: string): SkillSource {
  const raw = spec.trim();
  if (!raw) throw new Error("skill source is empty");

  if (raw.startsWith("./") || raw.startsWith("../") || path.isAbsolute(raw)) {
    return { kind: "local", root: path.resolve(raw), subpath: "" };
  }

  const hash = raw.indexOf("#");
  const main = hash >= 0 ? raw.slice(0, hash) : raw;
  const ref = hash >= 0 ? raw.slice(hash + 1) || undefined : undefined;

  if (main.startsWith("git@") || /^https?:\/\//i.test(main)) {
    return ref ? { kind: "git", url: main, subpath: "", ref } : { kind: "git", url: main, subpath: "" };
  }

  const parts = main.split("/").filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => /^[\w.-]+$/.test(p))) {
    const owner = parts[0]!;
    const repo = parts[1]!.replace(/\.git$/, "");
    const base = {
      kind: "git" as const,
      url: `https://github.com/${owner}/${repo}.git`,
      subpath: parts.slice(2).join("/"),
    };
    return ref ? { ...base, ref } : base;
  }

  throw new Error(
    `unrecognized skill source: ${spec} (use owner/repo, a git URL, or a local path)`,
  );
}

export type CloneFn = (url: string, dest: string, ref?: string) => void;

const defaultClone: CloneFn = (url, dest, ref) => {
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push(url, dest);
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "git clone failed").trim();
    throw new Error(detail);
  }
};

/**
 * Resolve a source to skill directories on disk (clones into a temp dir when remote).
 * Caller should delete `cleanup` when finished.
 */
export function materializeSkillDirs(
  spec: string,
  opts?: { clone?: CloneFn; tmpRoot?: string },
): { dirs: string[]; cleanup?: string } {
  const source = parseSkillSource(spec);
  if (source.kind === "local") {
    const target = source.subpath ? path.join(source.root, source.subpath) : source.root;
    return { dirs: findSkillDirs(target) };
  }

  const cleanup = mkdtempSync(path.join(opts?.tmpRoot ?? tmpdir(), "tah-skill-clone-"));
  try {
    (opts?.clone ?? defaultClone)(source.url, cleanup, source.ref);
    const target = source.subpath ? path.join(cleanup, source.subpath) : cleanup;
    if (!existsSync(target)) throw new Error(`path not in repo: ${source.subpath}`);
    return { dirs: findSkillDirs(target), cleanup };
  } catch (err) {
    rmSync(cleanup, { recursive: true, force: true });
    throw err;
  }
}

/** Install skills from a local path or git source into `~/.tah/skills` or `<cwd>/skills`. */
export function addRemoteSkills(opts: {
  homeDir: string;
  cwd: string;
  source: string;
  project?: boolean;
  /** Only these skill folder names; omit to install every skill found. */
  names?: string[];
  clone?: CloneFn;
}): { imported: string[]; skipped: string[] } {
  const materialize = opts.clone
    ? materializeSkillDirs(opts.source, { clone: opts.clone })
    : materializeSkillDirs(opts.source);
  const { dirs, cleanup } = materialize;
  try {
    let picked = dirs;
    if (opts.names?.length) {
      const want = new Set(opts.names);
      picked = dirs.filter((dir) => want.has(path.basename(dir)));
      const missing = opts.names.filter((name) => !picked.some((dir) => path.basename(dir) === name));
      if (missing.length) throw new Error(`skill not found: ${missing.join(", ")}`);
    }
    if (opts.project) {
      return importSkillsFrom(opts.homeDir, picked, path.join(path.resolve(opts.cwd), "skills"));
    }
    return importSkillsFrom(opts.homeDir, picked);
  } finally {
    if (cleanup) rmSync(cleanup, { recursive: true, force: true });
  }
}
