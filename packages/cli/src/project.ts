import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "@typescript-agent-harness/core";
import type { Tool } from "@typescript-agent-harness/tools";
import { createJiti } from "jiti";
import { formatCommand, installCommand } from "./install.js";

export const CLI_PACKAGE = "@typescript-agent-harness/cli";

const SOURCE = /\.(ts|mts|js|mjs)$/;
const SKIPPED = /^_|\.d\.m?ts$|\.(test|spec)\./;
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

/** Startup problems in the user's project files; printed without a stack trace. */
export class ProjectError extends Error {}

export type ProjectTool = { file: string; tool: Tool };

export type Project = {
  /** `AGENTS.md` text, if the file exists. */
  instructions?: string;
  tools: ProjectTool[];
  plugins: Plugin[];
  /** `tools/` exists: the built-in coding tools stay off unless `--builtin-tools`. */
  hasToolsDir: boolean;
};

/**
 * Only a cwd whose package.json depends on the CLI is a project, so `tah` in an
 * ordinary repo never imports (= runs) whatever happens to sit in its tools/ or plugins/.
 */
export function isProject(cwd: string): boolean {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch {
    return false;
  }
  return Boolean(pkg.dependencies?.[CLI_PACKAGE] ?? pkg.devDependencies?.[CLI_PACKAGE]);
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SOURCE.test(e.name) && !SKIPPED.test(e.name))
    .map((e) => e.name)
    .sort();
}

function baseName(file: string): string {
  return file.replace(SOURCE, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loadDefault(cwd: string, rel: string): Promise<unknown> {
  const jiti = createJiti(path.join(cwd, "package.json"));
  try {
    return await jiti.import(path.join(cwd, rel), { default: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing = /Cannot find (?:module|package) '([^'./][^']*)'/.exec(message)?.[1];
    if (missing) {
      throw new ProjectError(
        `tah: ${rel} imports "${missing}", which is not installed in ${cwd} — run: ${formatCommand(installCommand(cwd))}`,
      );
    }
    throw new ProjectError(`tah: failed to load ${rel}: ${message}`);
  }
}

async function loadTool(cwd: string, file: string): Promise<Tool> {
  const rel = `tools/${file}`;
  const mod = await loadDefault(cwd, rel);
  if (
    !isObject(mod) ||
    typeof mod.description !== "string" ||
    !isObject(mod.inputSchema) ||
    typeof mod.execute !== "function"
  ) {
    throw new ProjectError(
      `tah: ${rel} must export default defineTool({ description, inputSchema, execute })`,
    );
  }
  const name = typeof mod.name === "string" ? mod.name : baseName(file).replaceAll("-", "_");
  if (!TOOL_NAME.test(name)) {
    throw new ProjectError(
      `tah: ${rel}: tool name "${name}" is invalid (use a-z, 0-9, _ and start with a letter); rename the file or set name`,
    );
  }
  const execute = mod.execute as Tool["execute"];
  return {
    name,
    description: mod.description,
    inputSchema: mod.inputSchema as Tool["inputSchema"],
    execute: (input, ctx) => execute.call(mod, input, ctx),
  };
}

async function loadPlugin(cwd: string, file: string): Promise<Plugin> {
  const rel = `plugins/${file}`;
  const mod = await loadDefault(cwd, rel);
  if (!isObject(mod) || typeof mod.setup !== "function") {
    throw new ProjectError(`tah: ${rel} must export default definePlugin({ setup })`);
  }
  const setup = mod.setup as Plugin["setup"];
  const dispose = mod.dispose as Plugin["dispose"];
  const plugin: Plugin = {
    name: typeof mod.name === "string" ? mod.name : `project:${baseName(file)}`,
    setup: (ctx) => setup.call(mod, ctx),
  };
  if (typeof dispose === "function") {
    return { ...plugin, dispose: () => dispose.call(mod) };
  }
  return plugin;
}

/** `undefined` when `cwd` is not a project (see {@link isProject}). */
export async function loadProject(cwd: string): Promise<Project | undefined> {
  if (!isProject(cwd)) return undefined;
  const agentsFile = path.join(cwd, "AGENTS.md");
  const toolsDir = path.join(cwd, "tools");

  const tools: ProjectTool[] = [];
  for (const file of sourceFiles(toolsDir)) {
    const tool = await loadTool(cwd, file);
    const clash = tools.find((t) => t.tool.name === tool.name);
    if (clash) {
      throw new ProjectError(
        `tah: tools/${clash.file} and tools/${file} both define tool "${tool.name}"`,
      );
    }
    tools.push({ file, tool });
  }

  const plugins: Plugin[] = [];
  for (const file of sourceFiles(path.join(cwd, "plugins"))) {
    plugins.push(await loadPlugin(cwd, file));
  }

  const project: Project = { tools, plugins, hasToolsDir: existsSync(toolsDir) };
  if (existsSync(agentsFile)) project.instructions = readFileSync(agentsFile, "utf8");
  return project;
}
