import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

const ROOT_FILES = new Set(["AGENTS.md"]);
/** `lib/` holds the code tools share (see examples/convention-agent); it is never loaded on its own. */
const DIRS = ["tools", "plugins", "lib"];

/**
 * Calls `onChange` with the project-relative paths (`/`-separated) that changed in the last
 * `debounceMs`. Only `AGENTS.md`, `tools/`, `plugins/` and `lib/` count; the root is watched without
 * recursion so `node_modules` is never scanned. Returns a function that stops watching.
 */
export function watchProject(cwd: string, onChange: (files: string[]) => void, debounceMs = 200): () => void {
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

  const dirs = new Map<string, FSWatcher>();
  const syncDir = (name: string) => {
    const dir = path.join(cwd, name);
    const present = existsSync(dir);
    const watcher = dirs.get(name);
    if (present && !watcher) {
      const w = watch(dir, { recursive: true }, (_event, file) => {
        if (file) report(`${name}/${file.split(path.sep).join("/")}`);
      });
      w.on("error", () => {
        w.close();
        dirs.delete(name);
      });
      dirs.set(name, w);
    } else if (!present && watcher) {
      watcher.close();
      dirs.delete(name);
    }
  };

  const root = watch(cwd, (_event, file) => {
    if (!file) return;
    if (DIRS.includes(file)) {
      syncDir(file);
      report(file);
    } else if (ROOT_FILES.has(file)) {
      report(file);
    }
  });
  root.on("error", () => root.close());
  for (const name of DIRS) syncDir(name);

  return () => {
    clearTimeout(timer);
    root.close();
    for (const w of dirs.values()) w.close();
    dirs.clear();
  };
}
