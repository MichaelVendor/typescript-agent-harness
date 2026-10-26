import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { ProjectError, isProject } from "../project.js";
import { MOUNTED_SLOTS, TUI_SLOTS, type TuiModule, type TuiSlot } from "./modules.js";

const SOURCE = /\.(tsx|ts|jsx|js|mts|mjs)$/;
const SKIPPED = /^_|\.d\.m?ts$|\.(test|spec)\./;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SOURCE.test(e.name) && !SKIPPED.test(e.name))
    .map((e) => e.name)
    .sort();
}

function isSlot(value: string): value is TuiSlot {
  return (TUI_SLOTS as readonly string[]).includes(value);
}

export async function loadTuiModules(cwd: string): Promise<{
  modules: (TuiModule & { id: string })[];
  notices: string[];
}> {
  if (!isProject(cwd)) return { modules: [], notices: [] };
  const dir = path.join(cwd, "tui");
  const jiti = createJiti(path.join(cwd, "package.json"), {
    moduleCache: false,
    jsx: { runtime: "automatic" },
  } as never);
  const modules: (TuiModule & { id: string })[] = [];
  const notices: string[] = [];
  for (const file of files(dir)) {
    const rel = `tui/${file}`;
    let mod: unknown;
    try {
      mod = await jiti.import(path.join(cwd, rel), { default: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProjectError(`tah: failed to load ${rel}: ${message}`);
    }
    const row = mod as Partial<TuiModule> | null;
    if (!row || typeof row !== "object" || typeof row.Component !== "function" || typeof row.slot !== "string") {
      throw new ProjectError(`tah: ${rel} must export default defineTuiModule({ slot, Component })`);
    }
    if (!isSlot(row.slot)) {
      const id = typeof row.id === "string" ? row.id : file.replace(SOURCE, "");
      notices.push(`tui: ${id} declares slot "${row.slot}", which this version does not mount`);
      continue;
    }
    const id = typeof row.id === "string" ? row.id : file.replace(SOURCE, "");
    if (!ID.test(id)) {
      throw new ProjectError(`tah: ${rel}: module id "${id}" is invalid (kebab-case); rename the file or set id`);
    }
    if (modules.some((m) => m.id === id)) {
      throw new ProjectError(`tah: ${rel}: duplicate module id "${id}"`);
    }
    if (!(MOUNTED_SLOTS as readonly string[]).includes(row.slot)) {
      notices.push(`tui: ${id} declares slot "${row.slot}", which this version does not mount`);
      continue;
    }
    modules.push({ ...row, id, slot: row.slot, Component: row.Component });
  }
  return { modules, notices };
}
