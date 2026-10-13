import assert from "node:assert/strict";
import { test } from "node:test";
import type { SettingsView } from "@typescript-agent-harness/cli";
import { groupModels, modelLabel, providerName } from "../src/model-view.ts";

const m = (id: string, model: string, baseURL: string) => ({ id, model, baseURL, keyHint: "sk-…1234" });
const view = (extra: Partial<SettingsView>): SettingsView => ({ user: "u", models: [], activeModel: null, env: null, search: null, ...extra });

test("provider names: official endpoints by name, others by host", () => {
  assert.equal(providerName("https://api.deepseek.com/v1"), "DeepSeek");
  assert.equal(providerName("https://api.openai.com/v1"), "OpenAI");
  assert.equal(providerName("https://api.moonshot.cn/v1"), "api.moonshot.cn");
  assert.equal(providerName("http://127.0.0.1:8080/v1"), "127.0.0.1:8080");
});

test("models group by provider in the order they were added", () => {
  const groups = groupModels([
    m("a", "deepseek-chat", "https://api.deepseek.com/v1"),
    m("b", "gpt-5.6", "https://api.openai.com/v1"),
    m("c", "deepseek-reasoner", "https://api.deepseek.com/v1"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.name, g.models.map((x) => x.id)]),
    [
      ["DeepSeek", ["a", "c"]],
      ["OpenAI", ["b"]],
    ],
  );
});

test("the button reads the active model, else the .env one, else No model", () => {
  const models = [m("a", "deepseek-chat", "https://api.deepseek.com/v1")];
  const env = { model: "gpt-4o-mini", key: "OPENAI_API_KEY" as const };
  assert.equal(modelLabel(view({ models, activeModel: "a", env })), "deepseek-chat");
  assert.equal(modelLabel(view({ models, env })), "gpt-4o-mini · .env");
  assert.equal(modelLabel(view({ models })), "No model");
});
