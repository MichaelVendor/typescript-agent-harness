import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { ProjectError, isProject } from "../project.js";
import { MOUNTED_SLOTS, TUI_SLOTS, type TuiModule, type TuiSlot } from "./modules.js";

const selfRequire = createRequire(import.meta.url);
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
    // Modules share the CLI's own React and Ink, so the project needs no react install of its own.
    alias: {
      react: selfRequire.resolve("react"),
      "react/jsx-runtime": selfRequire.resolve("react/jsx-runtime"),
      "@typescript-agent-harness/cli": fileURLToPath(new URL("../index.js", import.meta.url)),
    },
  } as never);
  const seen = new Set<string>();
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
    const id = typeof row.id === "string" ? row.id : file.replace(SOURCE, "");
    // Ids are unique across every file, including ones on slots this version does not mount.
    if (seen.has(id)) {
      throw new ProjectError(`tah: ${rel}: duplicate module id "${id}"`);
    }
    seen.add(id);
    if (!isSlot(row.slot)) {
      notices.push(`tui: ${id} declares slot "${row.slot}", which this version does not mount`);
      continue;
    }
    if (!ID.test(id)) {
      throw new ProjectError(`tah: ${rel}: module id "${id}" is invalid (kebab-case); rename the file or set id`);
    }
    if (!(MOUNTED_SLOTS as readonly string[]).includes(row.slot)) {
      notices.push(`tui: ${id} declares slot "${row.slot}", which this version does not mount`);
      continue;
    }
    modules.push({ ...row, id, slot: row.slot, Component: row.Component });
  }
  return { modules, notices };
}
