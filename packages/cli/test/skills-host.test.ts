import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SESSION } from "@typescript-agent-harness/agent";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import { createChatHost, type HostEvent } from "../dist/host.js";
import { ProjectError } from "../dist/project.js";
import { bootRuntime } from "../dist/runtime.js";
import { applySlashSkills, stripSkillInjection } from "../dist/skills/slash.js";
import type { SkillSummary } from "../dist/skills/types.js";

const MARKER = JSON.stringify({ type: "module", devDependencies: { "@typescript-agent-harness/cli": "*" } });
const homeDir = mkdtempSync(path.join(tmpdir(), "tah-skills-home-"));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SKILL_TOOL = `export default {
  description: "echo",
  inputSchema: { type: "object" },
  async execute() { return "x"; },
};
`;

function writeTree(cwd: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(cwd, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function project(files: Record<string, string> = {}): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-skills-"));
  writeTree(cwd, { "package.json": MARKER, ...files });
  return cwd;
}

const skillMd = (name: string, body: string, extra = "") =>
  `---\nname: ${name}\ndescription: ${name} skill.\n${extra}---\n${body}\n`;

function runFlags(cwd: string, extra: string[] = []) {
  return { ...parseArgv(["--mock", "--no-persist", "--quiet", ...extra, "run", "hi"]), cwd };
}

function chatFlags(cwd: string, extra: string[] = []) {
  return { ...parseArgv(["--mock", "--no-exec", "--quiet", ...extra, "chat"]), cwd };
}

function messages(cwd: string, id: string): Array<{ role: string; content: unknown }> {
  const db = new DatabaseSync(path.join(cwd, ".tah", "cli.db"));
  const row = db.prepare("SELECT messages_json FROM sessions WHERE id = ?").get(id) as {
    messages_json: string;
  };
  db.close();
  return JSON.parse(row.messages_json) as Array<{ role: string; content: unknown }>;
}

async function waitFor(events: HostEvent[], match: (e: HostEvent) => boolean, from = 0): Promise<HostEvent> {
  for (let waited = 0; waited < 5000; waited += 25) {
    const hit = events.slice(from).find(match);
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error(`timed out waiting for an event; got ${JSON.stringify(events.slice(from))}`);
}

test("bootRuntime mounts the skill tool, catalog, and skills+N", async () => {
  const cwd = project({
    "skills/greet/SKILL.md": skillMd("greet", "Say hi."),
  });
  const booted = await bootRuntime(runFlags(cwd), { homeDir });
  try {
    assert.match(booted.startup, /skills\+1/);
    assert.deepEqual(booted.skills.map((s) => s.name), ["greet"]);
    const names = booted.runtime.get(TOOLS).list().map((t) => t.name);
    assert.ok(names.includes("skill"));
    const session = await booted.runtime.get(SESSION).create();
    const system = String(session.messages[0]?.content ?? "");
    assert.match(system, /Available skills/);
    assert.match(system, /greet/);
  } finally {
    await booted.runtime.stop();
  }
});

test("a user-only skill is listed but does not mount the skill tool", async () => {
  const cwd = project({
    "skills/manual/SKILL.md": skillMd("manual", "Do it by hand.", "disable-model-invocation: true\n"),
  });
  const booted = await bootRuntime(runFlags(cwd), { homeDir });
  try {
    assert.match(booted.startup, /skills\+1/);
    assert.equal(booted.skills[0]?.modelInvocable, false);
    const names = booted.runtime.get(TOOLS).list().map((t) => t.name);
    assert.equal(names.includes("skill"), false);
    const session = await booted.runtime.get(SESSION).create();
    assert.doesNotMatch(String(session.messages[0]?.content ?? ""), /Available skills/);
  } finally {
    await booted.runtime.stop();
  }
});

test("a project tool named skill is reserved at boot", async () => {
  const rejectSkill = async (cwd: string, extra: string[] = []) => {
    await assert.rejects(bootRuntime(runFlags(cwd, extra), { homeDir }), (err: unknown) => {
      assert.ok(err instanceof ProjectError);
      assert.match(err.message, /tools\/skill\.ts: tool "skill" is reserved by the CLI skills tool/);
      return true;
    });
  };
  await rejectSkill(project({ "tools/skill.ts": SKILL_TOOL }));
  await rejectSkill(
    project({
      "skills/greet/SKILL.md": skillMd("greet", "Say hi."),
      "tools/skill.ts": SKILL_TOOL,
    }),
    ["--builtin-tools"],
  );
});

test("applySlashSkills reports a load error instead of throwing", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-slash-miss-"));
  const summary: SkillSummary = {
    name: "gone",
    description: "Missing.",
    modelInvocable: false,
    userInvocable: true,
    dir: path.join(cwd, "gone"),
    skillFile: path.join(cwd, "gone", "SKILL.md"),
    source: "skills",
  };
  const slash = applySlashSkills("run /gone", [summary]);
  assert.equal(slash.displayText, "run /gone");
  assert.match(slash.modelSuffix, /<skill_content name="gone">/);
  assert.match(slash.modelSuffix, /Error:/);
});

test("host send keeps the user text and appends the skill for the model", async () => {
  const cwd = project({
    "AGENTS.md": "You are v1.",
    "skills/greet/SKILL.md": skillMd("greet", "Say hi."),
  });
  const host = await createChatHost(chatFlags(cwd, ["--no-watch"]), { homeDir });
  const events: HostEvent[] = [];
  host.on((e) => events.push(e));
  await host.open();
  try {
    await host.send("please /greet");
    const user = events.find((e) => e.type === "user");
    assert.deepEqual(user, { type: "user", text: "please /greet" });
    assert.deepEqual(
      host.snapshot().history.filter((h) => h.role === "user").map((h) => (h as { text: string }).text),
      ["please /greet"],
    );
    const stored = messages(cwd, host.sessionId).find((m) => m.role === "user");
    const content = String(stored?.content ?? "");
    assert.match(content, /^please \/greet\n\n<skill_content name="greet">/);
    assert.match(content, /Say hi\./);
  } finally {
    await host.close();
  }
});

test("reload rediscovers skills for catalog and slash", async () => {
  const cwd = project({
    "AGENTS.md": "You are v1.",
    "skills/greet/SKILL.md": skillMd("greet", "Say hi."),
  });
  const host = await createChatHost(chatFlags(cwd), { homeDir });
  const events: HostEvent[] = [];
  host.on((e) => events.push(e));
  await host.open();
  await sleep(300);
  try {
    const from = events.length;
    writeTree(cwd, { "skills/wave/SKILL.md": skillMd("wave", "Wave body.") });
    await waitFor(events, (e) => e.type === "notice" && /^\[tah\] reloaded:/.test(e.text), from);
    await host.send("/wave");
    const user = events.filter((e) => e.type === "user").at(-1);
    assert.deepEqual(user, { type: "user", text: "/wave" });
    const rows = messages(cwd, host.sessionId);
    assert.match(String(rows[0]?.content ?? ""), /wave/);
    const stored = rows.find((m) => m.role === "user");
    assert.match(String(stored?.content ?? ""), /<skill_content name="wave">/);
    assert.match(String(stored?.content ?? ""), /Wave body\./);
    assert.deepEqual(
      host.snapshot().history.filter((h) => h.role === "user").map((h) => (h as { text: string }).text),
      ["/wave"],
    );
  } finally {
    await host.close();
  }
});

test("plain tah chat sends /name to the model and keeps the user line", () => {
  const cwd = project({
    "skills/greet/SKILL.md": skillMd("greet", "Say hi."),
  });
  const env = { ...process.env, HOME: homeDir };
  delete env.DEEPSEEK_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.DEEPSEEK_BASE_URL;
  delete env.OPENAI_BASE_URL;
  const result = spawnSync(
    process.execPath,
    [cli, "--mock", "--cwd", cwd, "--quiet", "--plain", "chat"],
    { encoding: "utf8", input: "please /greet\n", env, timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const db = new DatabaseSync(path.join(cwd, ".tah", "cli.db"));
  const rows = db.prepare("SELECT messages_json FROM sessions").all() as Array<{ messages_json: string }>;
  db.close();
  const users = rows.flatMap((row) => {
    const msgs = JSON.parse(row.messages_json) as Array<{ role: string; content: unknown }>;
    return msgs.filter((m) => m.role === "user").map((m) => String(m.content));
  });
  assert.equal(users.length, 1);
  assert.match(users[0]!, /^please \/greet\n\n<skill_content name="greet">/);
  assert.match(users[0]!, /Say hi\./);
  assert.equal(stripSkillInjection(users[0]!), "please /greet");
});
