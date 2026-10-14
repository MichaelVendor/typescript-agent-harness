import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadShellEnv, parseEnvDump } from "../dist/shell-env.js";

const B = "__TAH_ENV_BEGIN__";
const E = "__TAH_ENV_END__";

function fakeShell(body: string): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "tah-shell-")), "fake-shell");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

test("parses the dump between the markers", () => {
  const out = `motd noise\n${B}A=1\0EMPTY=\0MULTI=line1\nline2\0EQ=a=b\0${E}trailing`;
  assert.deepEqual(parseEnvDump(out), { A: "1", EMPTY: "", MULTI: "line1\nline2", EQ: "a=b" });
});

test("no markers gives undefined", () => {
  assert.equal(parseEnvDump("A=1\0"), undefined);
  assert.equal(parseEnvDump(`${B}A=1\0`), undefined);
});

test("returns the login shell's environment", async () => {
  const shell = fakeShell('shift; exec /bin/sh -c "$1"');
  const result = await loadShellEnv({ shell, base: { PATH: "/usr/bin:/bin", FROM_BASE: "yes" } });
  assert.equal(result.error, undefined);
  assert.equal(result.env.FROM_BASE, "yes");
  assert.equal(result.env.DISABLE_AUTO_UPDATE, "true");
});

test("falls back to base when the shell hangs", async () => {
  const shell = fakeShell("exec sleep 10");
  const base = { PATH: "/usr/bin:/bin" };
  const started = Date.now();
  const result = await loadShellEnv({ shell, base, timeoutMs: 300 });
  assert.equal(result.env, base);
  assert.match(result.error ?? "", /timed out/);
  assert.ok(Date.now() - started < 3000);
});

test("falls back to base when the shell prints no markers", async () => {
  const result = await loadShellEnv({ shell: fakeShell("echo hello"), base: { PATH: "/usr/bin:/bin" } });
  assert.match(result.error ?? "", /no environment/);
});

test("falls back to base when the shell does not exist", async () => {
  const result = await loadShellEnv({ shell: "/nonexistent/shell", base: { PATH: "/usr/bin:/bin" } });
  assert.match(result.error ?? "", /ENOENT/);
});
