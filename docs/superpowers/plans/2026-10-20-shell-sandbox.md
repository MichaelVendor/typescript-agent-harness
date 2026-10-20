# Shell 沙箱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `execute_command` 在 macOS / Linux 上默认经操作系统沙箱启动，项目目录可写，家目录其余部分不可读。

**Architecture:** `packages/tools` 组装 `sandbox-exec` 或 `bwrap` 的参数，并用 `/bin/sh` 在 exec 用户程序前 touch 一个 ready 文件，用来区分助手失败和程序自己的退出码。CLI 只解析 `coding.sandbox` 与 `--sandbox` / `--no-sandbox`，把结果传给这个工具，并在启动行打印 `sandbox=`。

**Tech Stack:** Node.js ≥ 22、`node:child_process` `spawn`、`node:test`、macOS `sandbox-exec`、Linux `bwrap`。

**Spec:** `docs/superpowers/specs/2026-10-20-shell-sandbox-design.md`

## Global Constraints

- 沙箱只包 `execute_command` 及其子进程。不改 `read_file` / `write_file` / `edit_file` / `grep` / `list_files`。
- 不清理环境变量，不禁止网络，不用 Docker，不做 Windows 沙箱实现。
- 不改控制面启动参数。`--no-exec` 时工具不挂载，不报沙箱错误。
- 助手缺失时抛错，不退回无沙箱再跑一次。
- `--yes` 只跳过审批，不关掉沙箱。审批代码（`packages/cli/src/host.ts`）不要改。
- darwin / linux 默认开；win32 及其他默认关。命令行盖过 `tah.config.json`。
- 错误文本必须是：`shell sandbox unavailable: sandbox-exec`、`shell sandbox unavailable: bwrap`、`shell sandbox is unavailable on windows`、`shell sandbox failed: <第一行非空 stderr 或 exit N>`。
- 直接调用 `executeCommandTool(dir)` 且不传 `sandbox: true` 的现有测试保持无沙箱。默认打开只发生在 CLI 解析之后。

---

### Task 1: 安装目录与沙箱参数

**Files:**
- Create: `packages/tools/src/shell-sandbox.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `packages/tools/test/shell-sandbox.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export function installRoot(programRealpath: string, home: string, workspace: string): string | undefined;

export function shellSandboxArgv(input: {
  platform: "darwin" | "linux";
  workspace: string;
  home: string;
  programRealpath: string;
  userArgs: string[];
  readyFile: string;
  tmpdir: string;
  exists: (path: string) => boolean;
}): { args: string[]; profile?: string };
```

`installRoot`：真实路径在家目录内且不在项目内时才返回。所在目录名是 `bin` 且父目录不是家目录 → 返回该 `bin` 的父目录。否则返回所在目录。比较路径时用「相等，或带一个路径分隔符的前缀」，避免 `/Users/me` 匹配 `/Users/me2`。

`shellSandboxArgv` 不查找助手二进制。它只返回助手的参数。系统目录常量：`/usr`、`/bin`、`/opt`、`/opt/homebrew`、`/usr/local`、`/nix`、`/System`、`/Library`。`exists` 为 false 的目录不写进参数。临时目录用调用方传入的 `tmpdir`；`platform === "darwin"` 时再纳入存在的 `/tmp` 与 `/private/tmp`。安装目录只读、可执行。项目目录与临时目录可写。不绑定家目录本身。参数里不得出现 `unshare-net`。darwin 的 `profile` 含 `(allow network*)`，且不含 `deny network`。

trampoline 固定为这段 shell，后面的参数是 `["_"`、readyFile、programRealpath、...userArgs]`：

```text
touch "$1"; shift; exec "$@"
```

darwin 的 `args` 以 `["-p", profile, "--", "/bin/sh", "-c", <trampoline>, "_", readyFile, programRealpath, ...userArgs]` 开头。linux 的 `args` 在 `--` 之前是 `--ro-bind` 系统目录、`--bind` 项目与临时目录、`--ro-bind` 安装目录（若有）、`--dev` `/dev`、`--proc` `/proc`，然后同样的 `/bin/sh -c`。

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/tools exec node --test --experimental-strip-types test/shell-sandbox.test.ts`

Expected: FAIL because `shell-sandbox.ts` does not export the functions.

- [ ] **Step 3: Write minimal implementation**

实现上面的两个函数。`index.ts` 再导出它们。seatbelt 至少包含 `(version 1)`、`(deny default)`、对每个存在的系统目录 `(allow file-read* file-exec (subpath "..."))`、对项目和每个临时目录 `(allow file-read* file-write* file-exec (subpath "..."))`、对安装目录 `(allow file-read* file-exec (subpath "..."))`、`(allow file-read* file-write* (subpath "/dev"))`、`(allow network*)`、`(allow process*)`。

- [ ] **Step 4: Run test to verify it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/shell-sandbox.ts packages/tools/src/index.ts packages/tools/test/shell-sandbox.test.ts
git commit -m "$(cat <<'EOF'
feat(tools): 组装 execute_command 的沙箱参数

项目目录可写，家目录本身不出现在允许列表里。
EOF
)"
```

---

### Task 2: execute_command 经助手启动

**Files:**
- Modify: `packages/tools/src/exec-tool.ts`
- Modify: `packages/tools/src/index.ts`（若 `ExecuteCommandOptions` 已从这里导出，类型会跟着走）
- Test: `packages/tools/test/exec.test.ts`

**Interfaces:**
- Consumes: `shellSandboxArgv`、`installRoot`（Task 1）。调用方只经 `executeCommandTool` 使用。
- Produces: `ExecuteCommandOptions` 增加可选字段

```ts
sandbox?: boolean;
platform?: NodeJS.Platform;
homedir?: string;
lookup?: (name: string) => string | undefined;
realpath?: (file: string) => string;
exists?: (file: string) => boolean;
spawn?: typeof import("node:child_process").spawn;
```

`sandbox` 省略或 `false`：仍 `spawn(program, args)`，与现在相同。不要给 `spawn` 传 `env`，子进程继续继承父进程环境变量。`true` 时：`platform` 默认 `process.platform`，`homedir` 默认 `os.homedir()`，`realpath` 默认 `fs.realpathSync`，`exists` 默认 `fs.existsSync`。`lookup` 默认调用导出的 `lookupExecutable`。

```ts
export function lookupExecutable(name: string): string | undefined;
```

它按 `PATH` 逐项目录拼接文件名，`existsSync` 为真则返回该路径。不经过 shell。darwin 找 `sandbox-exec`，linux 找 `bwrap`。找不到就抛 `shell sandbox unavailable: <名字>`，且不调用 `spawn`。win32 且 `sandbox: true` 抛 `shell sandbox is unavailable on windows`。

找到助手后，ready 文件放在 `os.tmpdir()`，名字 `tah-sandbox-<随机>.ready`。`spawn(helper, shellSandboxArgv(...).args, { cwd, stdio })`。子进程结束后：ready 文件存在则返回现有的 `ExecuteCommandOutput`（含非 0 退出码）；不存在则抛 `shell sandbox failed: ` 加 stderr 第一行非空文本，stderr 为空则 `shell sandbox failed: exit <code>`。`finally` 里删除 ready 文件。

- [ ] **Step 1: Write the failing test**

在 `exec.test.ts` 追加。用注入的 `spawn`，不要真的执行沙箱。`spawn` 的替身记录 `file` 与 `args`，返回一个假 ChildProcess：`stdout` / `stderr` 是空的 Readable，`on("close")` 同步给出退出码，`on("error")` 忽略。

```ts
test("sandbox off spawns the program itself", async () => {
  let file = "";
  const tool = executeCommandTool(dir, {
    sandbox: false,
    spawn: ((bin: string) => {
      file = bin;
      return fakeChild(0, "", "");
    }) as never,
  });
  await tool.execute({ program: "node", args: ["-v"] }, ctx);
  assert.equal(file, "node");
});

test("missing helper throws and does not spawn", async () => {
  let spawned = false;
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "darwin",
    lookup: () => undefined,
    spawn: (() => {
      spawned = true;
      return fakeChild(0, "", "");
    }) as never,
  });
  await assert.rejects(
    () => tool.execute({ program: "node" }, ctx),
    /shell sandbox unavailable: sandbox-exec/,
  );
  assert.equal(spawned, false);
});

test("ready file present returns the program exit code", async () => {
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "linux",
    homedir: "/home/me",
    lookup: () => "/usr/bin/bwrap",
    realpath: (p: string) => p,
    exists: () => true,
    spawn: ((bin: string, args: string[]) => {
      assert.equal(bin, "/usr/bin/bwrap");
      const ready = args[args.indexOf("/bin/sh") + 3];
      writeFileSync(ready, "");
      return fakeChild(1, "", "");
    }) as never,
  });
  const out = await tool.execute({ program: "/usr/bin/node", args: ["-e", "1"] }, ctx);
  assert.equal(out.exitCode, 1);
});

test("ready file absent is a helper failure", async () => {
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "darwin",
    lookup: () => "/usr/bin/sandbox-exec",
    realpath: () => "/usr/bin/node",
    exists: () => true,
    spawn: () => fakeChild(1, "", "sandbox-exec: profile compilation failed\n") as never,
  });
  await assert.rejects(
    () => tool.execute({ program: "node" }, ctx),
    /shell sandbox failed: sandbox-exec: profile compilation failed/,
  );
});
```

`fakeChild` 与 `dir` / `ctx` 按文件里已有的 `toolCtx` 写法补齐。`program: "node"` 在沙箱路径里会先被现有的 `resolveProgram` 当成 PATH 名；测试里的 `realpath` 注入要覆盖「PATH 名没有斜杠」这一支：对无斜杠的程序，`realpath` 收到 lookup 之前的名字时，实现应先把 PATH 名交给 `lookup` 找真实文件，再 `realpath`。找不到用户程序时保持现在的 spawn 行为（让操作系统报错），不要把它说成沙箱助手缺失。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/tools exec node --test --experimental-strip-types test/exec.test.ts`

Expected: FAIL on `sandbox` option unknown or assertion mismatch. 原有用例仍应通过；若它们因默认打开沙箱而失败，说明默认值写错了，保持省略 `sandbox` 等于关。

- [ ] **Step 3: Write minimal implementation**

按 Interfaces 改 `execute()`。现有超时、截断、abort 逻辑包住沙箱子进程，不另写一套。

- [ ] **Step 4: Run test to verify it passes**

Same command. Expected: PASS，含原有用例。

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/exec-tool.ts packages/tools/src/index.ts packages/tools/test/exec.test.ts
git commit -m "$(cat <<'EOF'
feat(tools): execute_command 经沙箱助手启动

助手缺失直接失败；ready 文件存在时保留程序自己的退出码。
EOF
)"
```

---

### Task 3: 本机真隔离

**Files:**
- Test: `packages/tools/test/shell-sandbox-live.test.ts`

**Interfaces:**
- Consumes: `executeCommandTool` 的 `sandbox: true`（Task 2）
- Produces: 无新导出

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executeCommandTool, lookupExecutable, type ToolContext } from "@typescript-agent-harness/tools";

const helperName = process.platform === "darwin" ? "sandbox-exec" : process.platform === "linux" ? "bwrap" : "";
const helperPath = helperName ? lookupExecutable(helperName) : undefined;

test("sandboxed node cannot read a file outside the workspace", { skip: helperPath === undefined }, async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "tah-sbx-"));
  const outside = mkdtempSync(path.join(tmpdir(), "tah-sbx-out-"));
  const secret = path.join(outside, "secret.txt");
  const inside = path.join(workspace, "ok.txt");
  writeFileSync(secret, "nope");
  writeFileSync(inside, "yes");
  const tool = executeCommandTool(workspace, { sandbox: true, platform: process.platform });
  const ctx = { sessionId: "s", callId: "c", signal: new AbortController().signal, runtime: {} as ToolContext["runtime"] };
  const denied = await tool.execute(
    { program: process.execPath, args: ["-e", `require("node:fs").readFileSync(${JSON.stringify(secret)}, "utf8")`] },
    ctx,
  );
  assert.notEqual(denied.exitCode, 0);
  const ok = await tool.execute(
    { program: process.execPath, args: ["-e", `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(inside)}, "utf8"))`] },
    ctx,
  );
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.stdout, "yes");
});
```

`skip: helperPath === undefined` 已经在助手不在 PATH 时跳过，CI 不得因此失败。`ctx.runtime` 若类型不允许 `{}`，用 `exec.test.ts` 里的 `Runtime` 与 `toolCtx`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/tools exec node --test --experimental-strip-types test/shell-sandbox-live.test.ts`

Expected: 有助手时 FAIL（沙箱还没挡住，或 Task 2 已挡住则此步已经 PASS——若已 PASS，记下并继续，不要为了制造失败而改松沙箱）。没有助手时 SKIP。

- [ ] **Step 3: Write minimal implementation**

Task 2 的策略应当已经满足。若项目外文件仍能读到，只收紧 `shell-sandbox.ts` 里对应平台的允许路径，不要放宽家目录。

- [ ] **Step 4: Run test to verify it passes**

Same command. Expected: PASS 或 SKIP。再跑 `pnpm --filter @typescript-agent-harness/tools test`。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/shell-sandbox.ts packages/tools/test/shell-sandbox-live.test.ts
git commit -m "$(cat <<'EOF'
test(tools): 沙箱内读不到项目外的文件

助手不在 PATH 时跳过，CI 不因此失败。
EOF
)"
```

若本任务没有改 `shell-sandbox.ts`，就不要 `git add` 它。

---

### Task 4: 配置与命令行

**Files:**
- Modify: `packages/cli/src/config.ts`
- Modify: `packages/cli/src/args.ts`
- Modify: `packages/cli/test/config.test.ts`（`flagBits` 补上新字段的默认值）
- Modify: `packages/cli/test/resume-chat.test.ts`（`flags()` 补上 `sandbox` 与 `sandboxSet`）
- Test: `packages/cli/test/config.test.ts`、`packages/cli/test/defaults.test.ts`

**Interfaces:**
- Consumes: 无工具层类型
- Produces:

```ts
// TahConfig.capabilities.coding
boolean | { exec?: boolean; sandbox?: boolean }

// CliFlags
sandbox: boolean;
sandboxSet: boolean;

export function resolveShellSandbox(input: {
  exec: boolean;
  platform: NodeJS.Platform;
  configSandbox: boolean | undefined;
  flag: boolean;
  flagSet: boolean;
  helperFound: boolean;
}): "off" | "on" | "unavailable";
```

`coding: true` 或不写 `sandbox` → `configSandbox` 为 `undefined`（平台默认）。`{ "sandbox": false }` 解析为 `false`。未知 coding 键仍报 `unknown` 风格的现有错误。`ResolvedCapabilities` 增加 `sandbox: boolean | undefined`，只表示配置里写下来的值，还不含平台默认；平台默认放在 `resolveShellSandbox`。

`resolveShellSandbox`：`exec` 为 false 时返回 `"off"`（即使 `--sandbox` 且平台是 win32，也不抛错）。否则先用平台默认（darwin、linux 为开，其余为关），再被 `configSandbox` 覆盖，再被 `flagSet` 时的 `flag` 覆盖。结果为关 → `"off"`。结果为开且 `platform === "win32"` → 抛 `shell sandbox is unavailable on windows`。结果为开且 `helperFound` 为 false → `"unavailable"`。否则 `"on"`。

`--sandbox` / `--no-sandbox` 都设置 `sandboxSet`。两个都出现时，后面的那个决定 `sandbox`。帮助文本加两行，放在 `--no-exec` 下面。

- [ ] **Step 1: Write the failing test**

```ts
test("coding.sandbox parses and unknown coding keys still fail", () => {
  const parsed = parseTahConfig({ capabilities: { coding: { exec: true, sandbox: false } } });
  assert.deepEqual(parsed.capabilities?.coding, { exec: true, sandbox: false });
  assert.throws(
    () => parseTahConfig({ capabilities: { coding: { sandboxx: true } } }),
    /sandboxx|unknown/,
  );
});

test("resolveShellSandbox: flags beat config, windows throws, missing helper is unavailable", () => {
  assert.equal(
    resolveShellSandbox({ exec: true, platform: "darwin", configSandbox: false, flag: true, flagSet: true, helperFound: true }),
    "on",
  );
  assert.equal(
    resolveShellSandbox({ exec: true, platform: "linux", configSandbox: true, flag: false, flagSet: true, helperFound: true }),
    "off",
  );
  assert.equal(
    resolveShellSandbox({ exec: false, platform: "win32", configSandbox: undefined, flag: true, flagSet: true, helperFound: false }),
    "off",
  );
  assert.throws(
    () => resolveShellSandbox({ exec: true, platform: "win32", configSandbox: undefined, flag: true, flagSet: true, helperFound: false }),
    /shell sandbox is unavailable on windows/,
  );
  assert.equal(
    resolveShellSandbox({ exec: true, platform: "linux", configSandbox: undefined, flag: false, flagSet: false, helperFound: false }),
    "unavailable",
  );
});
```

`defaults.test.ts` 增加：`parseArgv(["--sandbox", "run", "hi"]).sandbox === true` 且 `sandboxSet === true`；随后再出现 `--no-sandbox` 时 `sandbox === false`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/cli exec node --test --experimental-strip-types test/config.test.ts test/defaults.test.ts`

这些测试从 `../dist/` 加载。先 `pnpm --filter @typescript-agent-harness/cli build` 只能证明旧 dist 失败。Expected: FAIL，`resolveShellSandbox` 不存在，或 `sandbox` 键被当成未知 coding 键。

- [ ] **Step 3: Write minimal implementation**

改 `CODING_OBJ_KEYS`、`parse` 分支、`CliFlags`、`parseArgv`、`resolveShellSandbox`。`flagBits` 默认 `sandbox: false`、`sandboxSet: false`。`resume-chat.test.ts` 的 `flags()` 同样补上这两个字段，否则 `tsc` 失败。

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @typescript-agent-harness/cli build`，再跑 Step 2 的测试命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config.ts packages/cli/src/args.ts packages/cli/test/config.test.ts packages/cli/test/defaults.test.ts packages/cli/test/resume-chat.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): 配置和命令行可以开关 shell 沙箱

--no-exec 时不因为 Windows 或缺少助手而启动失败。
EOF
)"
```

---

### Task 5: bootRuntime 接上沙箱

**Files:**
- Modify: `packages/cli/src/runtime.ts`（`executeCommandTool` 那一行，以及 `startup` 字符串）
- Test: `packages/cli/test/config.test.ts`

**Interfaces:**
- Consumes: `resolveShellSandbox`（Task 4）、`executeCommandTool(..., { sandbox })`（Task 2）
- Produces: `bootRuntime` 在 `exec` 为真时把沙箱状态传给工具。启动行在 `exec=on` 后面追加 `sandbox=on`、`sandbox=off` 或 `sandbox=unavailable`。`exec=off` 时不追加 `sandbox=`，也不调用会抛 Windows 错误的那条路径。

助手是否存在：darwin 用 `lookupExecutable("sandbox-exec")`，linux 用 `lookupExecutable("bwrap")`。该函数由 Task 2 从 `@typescript-agent-harness/tools` 导出。

- [ ] **Step 1: Write the failing test**

```ts
test("bootRuntime startup shows sandbox=off when --no-sandbox", async () => {
  const cwd = projectDir({});
  const flags = parseArgv(["--mock", "--no-persist", "--quiet", "--no-sandbox", "run", "hi"]);
  const { startup } = await bootRuntime({ ...flags, cwd }, { homeDir });
  assert.match(startup, /sandbox=off/);
});

test("bootRuntime does not mention sandbox when exec is off", async () => {
  const cwd = projectDir({});
  const flags = parseArgv(["--mock", "--no-persist", "--quiet", "--no-exec", "--sandbox", "run", "hi"]);
  const { startup } = await bootRuntime({ ...flags, cwd }, { homeDir });
  assert.match(startup, /exec=off/);
  assert.doesNotMatch(startup, /sandbox=/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/cli build && pnpm --filter @typescript-agent-harness/cli exec node --test --experimental-strip-types test/config.test.ts`

Expected: FAIL，启动行没有 `sandbox=off`。

- [ ] **Step 3: Write minimal implementation**

在算出 `exec` 之后调用 `resolveShellSandbox`。`"on"` 与 `"unavailable"` 都把 `executeCommandTool(flags.cwd, { sandbox: true })` 放进工具列表（工具自己会在调用时抛 unavailable）。`"off"` 使用原来的 `executeCommandTool(flags.cwd)`。启动行只在 `exec` 为真时追加 ` sandbox=${state}`。

- [ ] **Step 4: Run test to verify it passes**

Same command. Expected: PASS。然后 `pnpm --filter @typescript-agent-harness/cli test`。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/runtime.ts packages/cli/test/config.test.ts packages/tools/src/exec-tool.ts packages/tools/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): 启动时把 shell 沙箱挂到 execute_command

exec 关掉时启动行不提沙箱。
EOF
)"
```

只 add 本任务实际改过的文件。

---

### Task 6: 文档

**Files:**
- Modify: `docs/guide/tools.md`（`execute_command` 那一行）
- Modify: `docs/guide/cli.md`（Flags 里 `--exec` / `--no-exec` 附近）
- Modify: `docs/design/config.md`（`capabilities.coding` 那一行）
- Modify: `docs/guide/status.md`（未做列表）
- Modify: `docs/superpowers/specs/2026-10-20-shell-sandbox-design.md`（状态行）

**Interfaces:**
- Consumes: 前面任务的行为
- Produces: 无代码导出

- [ ] **Step 1: Write the docs to match the spec**

`tools.md` 的 `execute_command` 单元格改为：工作区 cwd 起进程（非 shell）。macOS / Linux 上默认经 `sandbox-exec` / `bwrap` 限制文件系统：项目目录可写，家目录其余部分不可读，网络仍可用，环境变量仍继承。`--no-sandbox` 关掉。助手不在 PATH 时该次调用失败。默认 30 秒超时，模型可按次传 `timeoutMs`（最长 10 分钟）。

`cli.md` 增加 `--sandbox`（macOS / Linux 上默认开）和 `--no-sandbox`。写明它们盖过 `capabilities.coding.sandbox`，且 `--yes` 不关掉沙箱。

`config.md` 的 coding 行补上 `sandbox?: boolean`。省略时 darwin / linux 为开，win32 为关。

`status.md` 未做列表改为只剩插件市场。删掉「shell/sandbox」。

规格状态行改为 `状态：✅ 已实现（计划：[2026-10-20-shell-sandbox.md](../plans/2026-10-20-shell-sandbox.md)）`。

- [ ] **Step 2: Search for the old claim**

Run: `rg "无 sandbox|shell/sandbox" docs packages/cli packages/tools`

Expected: 不再有「无 sandbox」或未做列表里的 `shell/sandbox`。规格的背景段可以保留「进程本身与用户的其他文件在同一个账号里」这种过去式描述。

- [ ] **Step 3: Commit**

```bash
git add docs/guide/tools.md docs/guide/cli.md docs/design/config.md docs/guide/status.md docs/superpowers/specs/2026-10-20-shell-sandbox-design.md
git commit -m "$(cat <<'EOF'
docs(sandbox): 说明 execute_command 的默认文件系统沙箱

EOF
)"
```

---

## Self-review

- 可见范围、安装目录两例、网络不禁、环境变量不清理：Task 1 的断言与 seatbelt / bwrap 参数。
- ready 文件区分助手失败和程序退出码：Task 2。
- 真隔离可跳过：Task 3。
- 配置、命令行覆盖、Windows 抛错、`--no-exec` 不抛错：Task 4。
- 启动行与工具挂载：Task 5。审批路径不在任何任务里。
- 文档与规格状态：Task 6。
- 控制面启动命令无任务修改。
