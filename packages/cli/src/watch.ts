import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

const ROOT_FILES = new Set(["AGENTS.md"]);
/** `lib/` holds the code tools share (see examples/convention-agent); it is never loaded on its own. */
const DIRS = ["tools", "plugins", "lib", "skills"];
const SKILL_PARENTS = [".agents", ".cursor"] as const;

export type WatchProjectOptions = {
  /** Home directory. When set, also watch `<homeSkillsDir>/.tah/skills` (reported as `.tah/skills/...`). */
  homeSkillsDir?: string;
};

/**
 * Calls `onChange` with the project-relative paths (`/`-separated) that changed in the last
 * `debounceMs`. `AGENTS.md`, `tools/`, `plugins/`, `lib/`, `skills/`, `.agents/skills/` and
 * `.cursor/skills/` count. `.agents` and `.cursor` are not watched as a whole. The project root
 * is watched without recursion so `node_modules` is never scanned. Returns a function that stops watching.
 */
export function watchProject(
  cwd: string,
  onChange: (files: string[]) => void,
  debounceMs = 200,
  opts: WatchProjectOptions = {},
): () => void {
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const report = (file: string) => {
    changed.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...changed];
      changed.clear();
      onChange(files);
    }, debounceMs);
  };

  const trees = new Map<string, FSWatcher>();
  const direct = new Map<string, FSWatcher>();

  const syncTree = (prefix: string, abs: string) => {
    const present = existsSync(abs);
    const watcher = trees.get(prefix);
    if (present && !watcher) {
      const w = watch(abs, { recursive: true }, (_event, file) => {
        if (file) report(`${prefix}/${file.split(path.sep).join("/")}`);
      });
      w.on("error", () => {
        w.close();
        trees.delete(prefix);
      });
      trees.set(prefix, w);
    } else if (!present && watcher) {
      watcher.close();
      trees.delete(prefix);
    }
  };

  const watchDirect = (key: string, abs: string, onFile: (file: string) => void) => {
    const present = existsSync(abs);
    const watcher = direct.get(key);
    if (present && !watcher) {
      const w = watch(abs, (_event, file) => {
        if (file) onFile(file);
      });
      w.on("error", () => {
        w.close();
        direct.delete(key);
      });
      direct.set(key, w);
    } else if (!present && watcher) {
      watcher.close();
      direct.delete(key);
    }
  };

  const syncSkillParent = (name: ".agents" | ".cursor") => {
    const abs = path.join(cwd, name);
    const skillsPrefix = `${name}/skills`;
    watchDirect(name, abs, (file) => {
      if (file.split(path.sep)[0] !== "skills") return;
      syncTree(skillsPrefix, path.join(abs, "skills"));
      report(skillsPrefix);
    });
    syncTree(skillsPrefix, path.join(abs, "skills"));
  };

  const root = watch(cwd, (_event, file) => {
    if (!file) return;
    if (DIRS.includes(file)) {
      syncTree(file, path.join(cwd, file));
      report(file);
    } else if (file === ".agents" || file === ".cursor") {
      syncSkillParent(file);
      if (existsSync(path.join(cwd, file, "skills"))) report(`${file}/skills`);
    } else if (ROOT_FILES.has(file)) {
      report(file);
    }
  });
  root.on("error", () => root.close());
  for (const name of DIRS) syncTree(name, path.join(cwd, name));
  for (const name of SKILL_PARENTS) syncSkillParent(name);

  if (opts.homeSkillsDir && existsSync(opts.homeSkillsDir)) {
    const tah = path.join(opts.homeSkillsDir, ".tah");
    const skillsAbs = path.join(tah, "skills");
    const prefix = ".tah/skills";
    watchDirect("home:.tah", tah, (file) => {
      if (file.split(path.sep)[0] !== "skills") return;
      syncTree(prefix, skillsAbs);
      report(prefix);
    });
    syncTree(prefix, skillsAbs);
  }

  return () => {
    clearTimeout(timer);
    root.close();
    for (const w of trees.values()) w.close();
    for (const w of direct.values()) w.close();
    trees.clear();
    direct.clear();
  };
}
