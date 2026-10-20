import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CliFlags } from "./args.js";
import { isProject, ProjectError, type Project } from "./project.js";

export type TahMcpExtension =
  | { transport: "stdio"; command: string; args: string[] }
  | { transport: "http"; url: string; headers: Record<string, string> };

export type TahPermissions = {
  allow?: string[];
  deny?: string[];
};

export type TahConfig = {
  capabilities?: {
    coding?: boolean | { exec?: boolean };
    web?: boolean;
    browser?: boolean;
    vision?: boolean;
  };
  extensions?: {
    /** One server, or several. A single object in the file is stored as a one-element list. */
    mcp?: TahMcpExtension[];
  };
  permissions?: TahPermissions;
};

export type ResolvedCapabilities = {
  coding: boolean;
  exec: boolean;
  web: boolean;
  browser: boolean;
  vision: boolean;
  /** Empty when MCP is off. */
  mcp: TahMcpExtension[];
  /** Empty when no allowlist is set (every tool not denied is allowed). */
  allow: string[];
  /** Empty when nothing is denied. Wins over `allow`. */
  deny: string[];
  /** True when a project `tah.config.json` was loaded. */
  fromConfig: boolean;
};

const TOP_KEYS = new Set(["capabilities", "extensions", "permissions"]);
const CAP_KEYS = new Set(["coding", "web", "browser", "vision"]);
const EXT_KEYS = new Set(["mcp"]);
const PERM_KEYS = new Set(["allow", "deny"]);
const CODING_OBJ_KEYS = new Set(["exec"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bad(rel: string, detail: string): never {
  throw new ProjectError(`tah: ${rel}: ${detail}`);
}

const MCP_KEYS = new Set(["command", "args", "url", "headers"]);

function parseMcpHeaders(
  headers: unknown,
  rel: string,
  label: string,
): Record<string, string> {
  if (!isObject(headers)) bad(rel, `${label}.headers must be an object`);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") bad(rel, `${label}.headers values must be strings`);
    out[key] = value;
  }
  return out;
}

function parseMcpServer(mcp: unknown, rel: string, label: string): TahMcpExtension {
  if (!isObject(mcp)) bad(rel, `${label} must be an object`);
  for (const key of Object.keys(mcp)) {
    if (!MCP_KEYS.has(key)) bad(rel, `unknown mcp option "${key}"`);
  }
  const hasCommand = typeof mcp.command === "string" && mcp.command.length > 0;
  const hasUrl = typeof mcp.url === "string" && mcp.url.length > 0;
  if (hasCommand && hasUrl) bad(rel, `${label} must set command or url, not both`);
  if (!hasCommand && !hasUrl) bad(rel, `${label} must set command or url`);
  if (hasUrl) {
    if ("args" in mcp) bad(rel, `${label}.args is only valid with command`);
    if ("headers" in mcp && !isObject(mcp.headers)) {
      bad(rel, `${label}.headers must be an object`);
    }
    let headers: Record<string, string> = {};
    if ("headers" in mcp) headers = parseMcpHeaders(mcp.headers, rel, label);
    return { transport: "http", url: mcp.url as string, headers };
  }
  if ("headers" in mcp) bad(rel, `${label}.headers is only valid with url`);
  let args: string[] = [];
  if ("args" in mcp) {
    if (!Array.isArray(mcp.args) || mcp.args.some((a) => typeof a !== "string")) {
      bad(rel, `${label}.args must be an array of strings`);
    }
    args = mcp.args as string[];
  }
  return { transport: "stdio", command: mcp.command as string, args };
}

function parseToolList(value: unknown, rel: string, label: string): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || name.length === 0)) {
    bad(rel, `${label} must be an array of non-empty strings`);
  }
  return [...value];
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
    if ("browser" in raw.capabilities) {
      if (typeof raw.capabilities.browser !== "boolean") bad(rel, "capabilities.browser must be a boolean");
      caps.browser = raw.capabilities.browser;
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
      if (Array.isArray(mcp)) {
        if (mcp.length === 0) bad(rel, "extensions.mcp must list at least one server");
        exts.mcp = mcp.map((server, i) => parseMcpServer(server, rel, `extensions.mcp[${i}]`));
      } else {
        exts.mcp = [parseMcpServer(mcp, rel, "extensions.mcp")];
      }
    }
    out.extensions = exts;
  }

  if ("permissions" in raw) {
    if (!isObject(raw.permissions)) bad(rel, "permissions must be an object");
    for (const key of Object.keys(raw.permissions)) {
      if (!PERM_KEYS.has(key)) bad(rel, `unknown permissions option "${key}"`);
    }
    const perms: TahPermissions = {};
    if ("allow" in raw.permissions) perms.allow = parseToolList(raw.permissions.allow, rel, "permissions.allow");
    if ("deny" in raw.permissions) perms.deny = parseToolList(raw.permissions.deny, rel, "permissions.deny");
    out.permissions = perms;
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

/** Merge built-in defaults, optional config, and explicit CLI / env overrides. `web` follows `coding` and `browser` follows `web` unless the config sets them. */
export function resolveCapabilities(
  config: TahConfig | undefined,
  flags: Pick<
    CliFlags,
    | "exec"
    | "execSet"
    | "builtinTools"
    | "vision"
    | "visionSet"
    | "mcpCommand"
    | "mcpArgs"
    | "allow"
    | "deny"
  >,
  project: Project | undefined,
): ResolvedCapabilities {
  let coding = !project?.hasToolsDir;
  let execWanted = flags.exec;
  let web: boolean | undefined;
  let browser: boolean | undefined;
  let vision = false;
  let mcp: TahMcpExtension[] = [];
  let allow: string[] = [];
  let deny: string[] = [];
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
    if (c.browser !== undefined) browser = c.browser;
    if (c.vision !== undefined) vision = c.vision;
  }
  if (config?.extensions?.mcp) {
    mcp = config.extensions.mcp.map((server) =>
      server.transport === "stdio"
        ? { transport: "stdio", command: server.command, args: [...server.args] }
        : { transport: "http", url: server.url, headers: { ...server.headers } },
    );
  }
  if (config?.permissions?.allow) allow = [...config.permissions.allow];
  if (config?.permissions?.deny) deny = [...config.permissions.deny];

  if (flags.builtinTools) coding = true;
  if (flags.execSet) execWanted = flags.exec;
  if (flags.visionSet) vision = flags.vision;
  if (flags.mcpCommand) {
    mcp = [{ transport: "stdio", command: flags.mcpCommand, args: [...flags.mcpArgs] }];
  }
  if (flags.allow.length > 0) allow = [...flags.allow];
  if (flags.deny.length > 0) deny = [...flags.deny];

  const webOn = web ?? coding;
  return {
    coding,
    exec: coding && execWanted,
    web: webOn,
    browser: browser ?? webOn,
    vision,
    mcp,
    allow,
    deny,
    fromConfig,
  };
}
