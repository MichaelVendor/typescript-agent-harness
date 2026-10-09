import { existsSync } from "node:fs";
import path from "node:path";

export type InstallCommand = { command: string; args: string[] };

function packageManager(cwd: string): "npm" | "pnpm" | "yarn" {
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm/")) return "pnpm";
  if (agent.startsWith("yarn/")) return "yarn";
  return "npm";
}

/** Nearest ancestor (not `cwd` itself) holding a pnpm-workspace.yaml. */
export function enclosingPnpmWorkspace(cwd: string): string | undefined {
  let dir = path.dirname(path.resolve(cwd));
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Lockfile in `cwd` first, then the package manager that launched us (npx / pnpm dlx / yarn dlx), else npm.
 * Inside another pnpm workspace, plain `pnpm install` installs that workspace and skips `cwd`.
 */
export function installCommand(cwd: string): InstallCommand {
  const pm = packageManager(cwd);
  if (pm === "pnpm" && enclosingPnpmWorkspace(cwd)) {
    return { command: "pnpm", args: ["install", "--ignore-workspace"] };
  }
  return { command: pm, args: ["install"] };
}

export function formatCommand(cmd: InstallCommand): string {
  return [cmd.command, ...cmd.args].join(" ");
}
