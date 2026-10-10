import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CliFlags } from "./args.js";
import { isProject, ProjectError, type Project } from "./project.js";

export type TahMcpExtension = { command: string; args: string[] };

export type TahConfig = {
  capabilities?: {
    coding?: boolean | { exec?: boolean };
    web?: boolean;
    vision?: boolean;
  };
  extensions?: {
    mcp?: TahMcpExtension;
  };
};

export type ResolvedCapabilities = {
  coding: boolean;
  exec: boolean;
  web: boolean;
  vision: boolean;
  mcp: TahMcpExtension | undefined;
  /** True when a project `tah.config.json` was loaded. */
  fromConfig: boolean;
};

const TOP_KEYS = new Set(["capabilities", "extensions"]);
const CAP_KEYS = new Set(["coding", "web", "vision"]);
const EXT_KEYS = new Set(["mcp"]);
const CODING_OBJ_KEYS = new Set(["exec"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bad(rel: string, detail: string): never {
  throw new ProjectError(`tah: ${rel}: ${detail}`);
}

/** Parse and validate a config object; `rel` is only for error messages. */
export function parseTahConfig(raw: unknown, rel = "tah.config.json"): TahConfig {
  if (!isObject(raw)) bad(rel, "must be a JSON object");
  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.has(key)) bad(rel, `unknown key "${key}"`);
  }

  const out: TahConfig = {};

  if ("capabilities" in raw) {
    if (!isObject(raw.capabilities)) bad(rel, "capabilities must be an object");
    for (const key of Object.keys(raw.capabilities)) {
      if (!CAP_KEYS.has(key)) bad(rel, `unknown capability "${key}"`);
    }
    const caps: NonNullable<TahConfig["capabilities"]> = {};
    if ("coding" in raw.capabilities) {
      const coding = raw.capabilities.coding;
      if (typeof coding === "boolean") {
        caps.coding = coding;
      } else if (isObject(coding)) {
        for (const key of Object.keys(coding)) {
          if (!CODING_OBJ_KEYS.has(key)) bad(rel, `unknown coding option "${key}"`);
        }
        if ("exec" in coding && typeof coding.exec !== "boolean") {
          bad(rel, "capabilities.coding.exec must be a boolean");
        }
        caps.coding = typeof coding.exec === "boolean" ? { exec: coding.exec } : {};
      } else {
        bad(rel, "capabilities.coding must be a boolean or { exec?: boolean }");
      }
    }
    if ("web" in raw.capabilities) {
      if (typeof raw.capabilities.web !== "boolean") bad(rel, "capabilities.web must be a boolean");
      caps.web = raw.capabilities.web;
    }
    if ("vision" in raw.capabilities) {
      if (typeof raw.capabilities.vision !== "boolean") {
        bad(rel, "capabilities.vision must be a boolean");
      }
      caps.vision = raw.capabilities.vision;
    }
    out.capabilities = caps;
  }

  if ("extensions" in raw) {
    if (!isObject(raw.extensions)) bad(rel, "extensions must be an object");
    for (const key of Object.keys(raw.extensions)) {
      if (!EXT_KEYS.has(key)) bad(rel, `unknown extension "${key}"`);
    }
    const exts: NonNullable<TahConfig["extensions"]> = {};
    if ("mcp" in raw.extensions) {
      const mcp = raw.extensions.mcp;
      if (!isObject(mcp)) bad(rel, "extensions.mcp must be an object");
      for (const key of Object.keys(mcp)) {
        if (key !== "command" && key !== "args") bad(rel, `unknown mcp option "${key}"`);
      }
      if (typeof mcp.command !== "string" || mcp.command.length === 0) {
        bad(rel, "extensions.mcp.command must be a non-empty string");
      }
      let args: string[] = [];
      if ("args" in mcp) {
        if (!Array.isArray(mcp.args) || mcp.args.some((a) => typeof a !== "string")) {
          bad(rel, "extensions.mcp.args must be an array of strings");
        }
        args = mcp.args as string[];
      }
      exts.mcp = { command: mcp.command, args };
    }
    out.extensions = exts;
  }

  return out;
}

/**
 * Load `<cwd>/tah.config.json` when cwd is a convention project and the file exists.
 * Returns `undefined` when not a project or the file is absent.
 */
export function loadTahConfig(cwd: string): TahConfig | undefined {
  if (!isProject(cwd)) return undefined;
  const file = path.join(path.resolve(cwd), "tah.config.json");
  if (!existsSync(file)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ProjectError(`tah: tah.config.json: ${message}`);
  }
  return parseTahConfig(raw);
}

/**
 * Merge built-in defaults, optional config, and explicit CLI / env overrides.
 * `capabilities.web: true` is accepted here; the caller must refuse to boot until web tools exist.
 */
export function resolveCapabilities(
  config: TahConfig | undefined,
  flags: Pick<CliFlags, "exec" | "execSet" | "builtinTools" | "vision" | "visionSet" | "mcpCommand" | "mcpArgs">,
  project: Project | undefined,
): ResolvedCapabilities {
  let coding = !project?.hasToolsDir;
  let execWanted = flags.exec;
  let web = false;
  let vision = false;
  let mcp: TahMcpExtension | undefined;
  const fromConfig = config !== undefined;

  if (config?.capabilities) {
    const c = config.capabilities;
    if (c.coding !== undefined) {
      if (typeof c.coding === "boolean") {
        coding = c.coding;
      } else {
        coding = true;
        if (typeof c.coding.exec === "boolean") execWanted = c.coding.exec;
      }
    }
    if (c.web !== undefined) web = c.web;
    if (c.vision !== undefined) vision = c.vision;
  }
  if (config?.extensions?.mcp) {
    mcp = { command: config.extensions.mcp.command, args: [...config.extensions.mcp.args] };
  }

  if (flags.builtinTools) coding = true;
  if (flags.execSet) execWanted = flags.exec;
  if (flags.visionSet) vision = flags.vision;
  if (flags.mcpCommand) {
    mcp = { command: flags.mcpCommand, args: [...flags.mcpArgs] };
  }

  return {
    coding,
    exec: coding && execWanted,
    web,
    vision,
    mcp,
    fromConfig,
  };
}

/** Refuse fake-on web until the tools are mounted. */
export function assertWebImplemented(caps: ResolvedCapabilities): void {
  if (caps.web) {
    throw new ProjectError(
      "tah: capabilities.web is not implemented yet — omit it or set false until web_search / web_fetch ship",
    );
  }
}
