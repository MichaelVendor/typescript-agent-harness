import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../dist/prompt.js";

test("buildSystemPrompt without exec tells user to drop --no-exec", () => {
  const prompt = buildSystemPrompt({ exec: false, mcp: false });
  assert.match(prompt, /--no-exec/);
  assert.doesNotMatch(prompt, /Use execute_command/);
});

test("buildSystemPrompt: custom role replaces only the role line", () => {
  const prompt = buildSystemPrompt({ exec: true, mcp: false, role: "You are a code reviewer.\n" });
  assert.match(prompt, /^You are a code reviewer\.\n\nPrefer list_files/);
  assert.doesNotMatch(prompt, /workspace coding agent/);
  assert.match(prompt, /execute_command/);
});

test("buildSystemPrompt with exec mentions execute_command", () => {
  const prompt = buildSystemPrompt({ exec: true, mcp: false });
  assert.match(prompt, /execute_command/);
  assert.doesNotMatch(prompt, /--no-exec/);
});
