import assert from "node:assert/strict";
import { test } from "node:test";
import { installRoot, shellSandboxArgv } from "@typescript-agent-harness/tools";

const home = "/Users/me";
const workspace = "/Users/me/proj";
const exists = (p: string) =>
  ["/usr", "/bin", "/opt/homebrew", "/System", "/tmp", "/private/tmp"].includes(p);

test("install root is the nvm version dir, or ~/bin, and never the workspace or /opt", () => {
  assert.equal(
    installRoot("/Users/me/.nvm/versions/node/v22/bin/node", home, workspace),
    "/Users/me/.nvm/versions/node/v22",
  );
  assert.equal(installRoot("/Users/me/bin/tool", home, workspace), "/Users/me/bin");
  assert.equal(installRoot("/opt/homebrew/bin/node", home, workspace), undefined);
  assert.equal(installRoot("/Users/me/proj/node_modules/.bin/tsc", home, workspace), undefined);
});

test("darwin profile can write the workspace and not the home directory", () => {
  const plan = shellSandboxArgv({
    platform: "darwin",
    workspace,
    home,
    programRealpath: "/Users/me/.nvm/versions/node/v22/bin/node",
    userArgs: ["-e", "1"],
    readyFile: "/private/tmp/tah-ready",
    tmpdir: "/private/tmp",
    exists,
  });
  const profile = plan.profile ?? "";
  const systemAllow = profile.indexOf('(subpath "/System")');
  const dataDeny = profile.indexOf("/System/Volumes/Data/Users/");
  const workspaceAllow = profile.indexOf(`(subpath "${workspace}")`);
  assert.ok(systemAllow !== -1 && dataDeny > systemAllow && workspaceAllow > dataDeny);
  assert.match(profile, new RegExp(`\\(subpath "${workspace}"\\)`));
  assert.match(profile, /\/Users\/me\/\.nvm\/versions\/node\/v22/);
  assert.doesNotMatch(profile, /\(subpath "\/Users\/me"\)/);
  assert.match(profile, /\(allow network\*\)/);
  assert.doesNotMatch(profile, /deny network/);
  assert.equal(plan.args.at(-3), "/Users/me/.nvm/versions/node/v22/bin/node");
  assert.deepEqual(plan.args.slice(-2), ["-e", "1"]);
});

test("linux argv bind-mounts the workspace and does not drop the network", () => {
  const plan = shellSandboxArgv({
    platform: "linux",
    workspace: "/work",
    home: "/home/me",
    programRealpath: "/usr/bin/node",
    userArgs: ["-v"],
    readyFile: "/tmp/tah-ready",
    tmpdir: "/tmp",
    exists: (p) => p === "/usr" || p === "/bin" || p === "/tmp",
  });
  assert.equal(plan.profile, undefined);
  assert.ok(plan.args.includes("--bind"));
  assert.ok(plan.args.includes("/work"));
  assert.equal(plan.args.includes("--unshare-net"), false);
  assert.equal(plan.args.includes("--ro-bind"), true);
});

test("linux argv bind-mounts lib64 and etc only when they exist", () => {
  const base = {
    platform: "linux" as const,
    workspace: "/work",
    home: "/home/me",
    programRealpath: "/usr/bin/node",
    userArgs: ["-v"],
    readyFile: "/tmp/tah-ready",
    tmpdir: "/tmp",
  };
  const present = shellSandboxArgv({
    ...base,
    exists: (p) => ["/usr", "/bin", "/tmp", "/lib64", "/etc"].includes(p),
  });
  for (const dir of ["/lib64", "/etc"]) {
    const at = present.args.indexOf(dir);
    assert.ok(at >= 1);
    assert.deepEqual(present.args.slice(at - 1, at + 2), ["--ro-bind", dir, dir]);
  }
  const absent = shellSandboxArgv({
    ...base,
    exists: (p) => p === "/usr" || p === "/bin" || p === "/tmp",
  });
  assert.equal(absent.args.includes("/lib64"), false);
  assert.equal(absent.args.includes("/etc"), false);
});
