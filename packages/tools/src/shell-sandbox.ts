import path from "node:path";

const SYSTEM_DIRS = [
  "/usr",
  "/bin",
  "/opt",
  "/opt/homebrew",
  "/usr/local",
  "/nix",
  "/System",
  "/Library",
] as const;

const TRAMPOLINE = 'touch "$1"; shift; exec "$@"';

function isPathUnder(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

export function installRoot(
  programRealpath: string,
  home: string,
  workspace: string,
): string | undefined {
  if (!isPathUnder(home, programRealpath)) {
    return undefined;
  }
  if (isPathUnder(workspace, programRealpath)) {
    return undefined;
  }
  const dir = path.dirname(programRealpath);
  if (path.basename(dir) === "bin") {
    const parent = path.dirname(dir);
    if (parent !== home) {
      return parent;
    }
  }
  return dir;
}

function tempDirs(platform: "darwin" | "linux", tmpdir: string, exists: (path: string) => boolean): string[] {
  const dirs = new Set<string>();
  if (exists(tmpdir)) {
    dirs.add(tmpdir);
  }
  if (platform === "darwin") {
    for (const p of ["/tmp", "/private/tmp"]) {
      if (exists(p)) {
        dirs.add(p);
      }
    }
  }
  return [...dirs];
}

function darwinProfile(input: {
  workspace: string;
  install: string | undefined;
  temp: string[];
  exists: (path: string) => boolean;
}): string {
  const lines: string[] = ["(version 1)", "(deny default)"];
  for (const dir of SYSTEM_DIRS) {
    if (input.exists(dir)) {
      lines.push(`(allow file-read* file-exec (subpath "${dir}"))`);
    }
  }
  lines.push(`(allow file-read* file-write* file-exec (subpath "${input.workspace}"))`);
  for (const dir of input.temp) {
    lines.push(`(allow file-read* file-write* file-exec (subpath "${dir}"))`);
  }
  if (input.install !== undefined) {
    lines.push(`(allow file-read* file-exec (subpath "${input.install}"))`);
  }
  lines.push('(allow file-read* file-write* (subpath "/dev"))');
  lines.push("(allow network*)");
  lines.push("(allow process*)");
  return lines.join("\n");
}

function linuxRoBind(dir: string): string[] {
  return ["--ro-bind", dir, dir];
}

function linuxBind(dir: string): string[] {
  return ["--bind", dir, dir];
}

export function shellSandboxArgv(input: {
  platform: "darwin" | "linux";
  workspace: string;
  home: string;
  programRealpath: string;
  userArgs: string[];
  readyFile: string;
  tmpdir: string;
  exists: (path: string) => boolean;
}): { args: string[]; profile?: string } {
  const install = installRoot(input.programRealpath, input.home, input.workspace);
  const temp = tempDirs(input.platform, input.tmpdir, input.exists);
  const shTail = ["/bin/sh", "-c", TRAMPOLINE, "_", input.readyFile, input.programRealpath, ...input.userArgs];

  if (input.platform === "darwin") {
    const profile = darwinProfile({
      workspace: input.workspace,
      install,
      temp,
      exists: input.exists,
    });
    return {
      profile,
      args: ["-p", profile, "--", ...shTail],
    };
  }

  const args: string[] = [];
  for (const dir of SYSTEM_DIRS) {
    if (input.exists(dir)) {
      args.push(...linuxRoBind(dir));
    }
  }
  args.push(...linuxBind(input.workspace));
  for (const dir of temp) {
    args.push(...linuxBind(dir));
  }
  if (install !== undefined) {
    args.push(...linuxRoBind(install));
  }
  args.push("--dev", "/dev", "--proc", "/proc", "--", ...shTail);
  return { args };
}
