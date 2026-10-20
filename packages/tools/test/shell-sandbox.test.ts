import assert from "node:assert/strict";
import { test } from "node:test";
import { installRoot, shellSandboxArgv } from "@typescript-agent-harness/tools";

const home = "/Users/me";
const workspace = "/Users/me/proj";
const exists = (p: string) =>
  ["/usr", "/bin", "/opt/homebrew", "/tmp", "/private/tmp"].includes(p);

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
  assert.match(plan.profile ?? "", new RegExp(`\\(subpath "${workspace}"\\)`));
  assert.match(plan.profile ?? "", /\/Users\/me\/\.nvm\/versions\/node\/v22/);
  assert.doesNotMatch(plan.profile ?? "", /\(subpath "\/Users\/me"\)/);
  assert.match(plan.profile ?? "", /\(allow network\*\)/);
  assert.doesNotMatch(plan.profile ?? "", /deny network/);
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
