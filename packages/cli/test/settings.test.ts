import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  activeModel,
  addModel,
  defaultBaseURL,
  keyHint,
  loadSettings,
  removeModel,
  setActiveModel,
  settingsPath,
} from "../dist/settings.js";

const home = () => mkdtempSync(path.join(tmpdir(), "tah-settings-"));

test("settings: first model becomes active; add / switch / remove; file is private", () => {
  const h = home();
  assert.deepEqual(loadSettings(h), { models: [] });
  assert.equal(activeModel(h), undefined);

  const a = addModel(h, { model: "deepseek-chat", apiKey: "sk-aaaa1111" });
  const b = addModel(h, { model: "gpt-4o", apiKey: "sk-bbbb2222", baseURL: "https://example.com/v1" });
  assert.equal(activeModel(h)?.id, a.id);
  assert.equal(statSync(settingsPath(h)).mode & 0o777, 0o600);

  setActiveModel(h, b.id);
  assert.equal(activeModel(h)?.model, "gpt-4o");
  setActiveModel(h, null);
  assert.equal(activeModel(h), undefined);
  assert.throws(() => setActiveModel(h, "nope"), /no model/);

  setActiveModel(h, b.id);
  removeModel(h, b.id);
  assert.equal(activeModel(h), undefined);
  assert.deepEqual(loadSettings(h).models.map((m) => m.id), [a.id]);
});

test("settings: names and keys are required; corrupt file reads as empty", () => {
  const h = home();
  assert.throws(() => addModel(h, { model: " ", apiKey: "k" }), /model/);
  assert.throws(() => addModel(h, { model: "m", apiKey: "" }), /API key/);
  mkdirSync(path.join(h, ".tah"), { recursive: true });
  writeFileSync(settingsPath(h), "{");
  assert.deepEqual(loadSettings(h), { models: [] });
});

test("settings: default base URL follows the model name; key hint hides the key", () => {
  assert.equal(defaultBaseURL("deepseek-reasoner"), "https://api.deepseek.com/v1");
  assert.equal(defaultBaseURL("gpt-4o-mini"), "https://api.openai.com/v1");
  assert.equal(keyHint("sk-abcdefgh1234"), "sk-…1234");
  assert.equal(keyHint("short"), "…");
});
