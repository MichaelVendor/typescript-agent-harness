import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolContext } from "./types.js";

function resolveInRoot(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return resolved;
}

export function listFilesTool(workspaceRoot: string): Tool<{ directory?: string }, unknown> {
  return {
    name: "list_files",
    description: "List files and directories under a relative path (workspace-scoped).",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Relative directory, default '.'",
        },
      },
      additionalProperties: false,
    },
    async execute(input) {
      const dir = resolveInRoot(workspaceRoot, input.directory ?? ".");
      const entries = await readdir(dir, { withFileTypes: true });
      return {
        directory: path.relative(workspaceRoot, dir) || ".",
        entries: entries
          .filter((e) => !e.name.startsWith("."))
          .map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "dir" : "file",
          })),
      };
    },
  };
}

export function readFileTool(workspaceRoot: string): Tool<{ path: string }, unknown> {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file (workspace-scoped, truncated at 32KiB).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(input) {
      const filePath = resolveInRoot(workspaceRoot, input.path);
      const info = await stat(filePath);
      if (!info.isFile()) {
        throw new Error(`not a file: ${input.path}`);
      }
      const buf = await readFile(filePath);
      const truncated = buf.byteLength > 32 * 1024;
      const content = buf.subarray(0, 32 * 1024).toString("utf8");
      return { path: input.path, content, truncated };
    },
  };
}

export function writeFileTool(
  workspaceRoot: string,
): Tool<{ path: string; content: string }, unknown> {
  return {
    name: "write_file",
    description: "Write a UTF-8 text file (workspace-scoped).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "File contents" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    async execute(input) {
      const filePath = resolveInRoot(workspaceRoot, input.path);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, input.content, "utf8");
      return { path: input.path, bytes: Buffer.byteLength(input.content, "utf8") };
    },
  };
}

const GREP_SKIP = new Set(["node_modules", "dist"]);
const GREP_MAX_MATCHES = 50;
const GREP_MAX_FILE = 32 * 1024;
const GREP_MAX_PATTERN = 200;

export type GrepMatch = { path: string; line: number; text: string };

export function grepTool(
  workspaceRoot: string,
): Tool<{ pattern: string; directory?: string }, { matches: GrepMatch[]; truncated: boolean }> {
  const root = path.resolve(workspaceRoot);
  return {
    name: "grep",
    description:
      "Search UTF-8 files under a relative directory for a JavaScript regex. Skips dotfiles, node_modules, and dist. Caps matches at 50.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression" },
        directory: { type: "string", description: "Relative directory, default '.'" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    async execute(input, ctx: ToolContext) {
      if (!input.pattern || input.pattern.length > GREP_MAX_PATTERN) {
        throw new Error(`pattern must be 1–${GREP_MAX_PATTERN} characters`);
      }
      let re: RegExp;
      try {
        re = new RegExp(input.pattern);
      } catch {
        throw new Error(`invalid pattern: ${input.pattern}`);
      }
      const start = resolveInRoot(root, input.directory ?? ".");
      const matches: GrepMatch[] = [];
      let truncated = false;

      const walk = async (dir: string): Promise<void> => {
        if (ctx.signal.aborted) throw new Error("aborted");
        if (matches.length >= GREP_MAX_MATCHES) {
          truncated = true;
          return;
        }
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (matches.length >= GREP_MAX_MATCHES) {
            truncated = true;
            return;
          }
          if (e.name.startsWith(".") || GREP_SKIP.has(e.name)) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            await walk(full);
            continue;
          }
          if (!e.isFile()) continue;
          const info = await stat(full);
          if (!info.isFile()) continue;
          const buf = await readFile(full);
          if (buf.includes(0)) continue;
          const content = buf.subarray(0, GREP_MAX_FILE).toString("utf8");
          const rel = path.relative(root, full) || e.name;
          const lines = content.split(/\n/);
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= GREP_MAX_MATCHES) {
              truncated = true;
              return;
            }
            if (!re.test(lines[i]!)) continue;
            matches.push({
              path: rel,
              line: i + 1,
              text: lines[i]!.slice(0, 200),
            });
          }
        }
      };

      await walk(start);
      return { matches, truncated };
    },
  };
}
