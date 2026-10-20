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

function seatbeltPathRegex(dir: string): string {
  const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}(/|$)`;
}

function dataVolumeHomeAlias(home: string): string | undefined {
  const match = /^\/Users\/([^/]+)$/.exec(home);
  if (match === null) {
    return undefined;
  }
  return `/System/Volumes/Data/Users/${match[1]}`;
}

function homeDenyPaths(home: string, homeRealpath: string): string[] {
  const paths = new Set<string>([home, homeRealpath]);
  for (const candidate of [home, homeRealpath]) {
    const alias = dataVolumeHomeAlias(candidate);
    if (alias !== undefined) {
      paths.add(alias);
    }
  }
  return [...paths];
}

function darwinProfile(input: {
  home: string;
  homeRealpath: string;
  workspace: string;
  install: string | undefined;
  temp: string[];
  exists: (path: string) => boolean;
}): string {
  const lines: string[] = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow mach-lookup)",
    "(allow sysctl-read)",
    "(allow ipc-posix-shm)",
    "(allow file-read* file-map-executable)",
  ];
  for (const dir of input.temp) {
    lines.push(`(allow file-read* file-write* file-map-executable (subpath "${dir}"))`);
  }
  for (const dir of SYSTEM_DIRS) {
    if (input.exists(dir)) {
      lines.push(`(allow file-read* file-map-executable (subpath "${dir}"))`);
    }
  }
  lines.push('(allow file-read* file-write* (subpath "/dev"))');
  lines.push("(allow network*)");
  for (const dir of homeDenyPaths(input.home, input.homeRealpath)) {
    lines.push(
      `(deny file-read* file-write* file-map-executable (regex #"${seatbeltPathRegex(dir)}"))`,
    );
  }
  lines.push(
    `(allow file-read* file-write* file-map-executable (subpath "${input.workspace}"))`,
  );
  if (input.install !== undefined) {
    lines.push(`(allow file-read* file-map-executable (subpath "${input.install}"))`);
  }
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
  homeRealpath?: string;
  exists: (path: string) => boolean;
}): { args: string[]; profile?: string } {
  const install = installRoot(input.programRealpath, input.home, input.workspace);
  const temp = tempDirs(input.platform, input.tmpdir, input.exists);
  const shTail = ["/bin/sh", "-c", TRAMPOLINE, "_", input.readyFile, input.programRealpath, ...input.userArgs];

  if (input.platform === "darwin") {
    const profile = darwinProfile({
      home: input.home,
      homeRealpath: input.homeRealpath ?? input.home,
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
