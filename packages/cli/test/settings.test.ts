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
  searchKey,
  setActiveModel,
  setModelVision,
  setSearchKey,
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

test("settings: the Tavily key survives model changes; settings beat TAVILY_API_KEY", () => {
  const h = home();
  const prev = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    assert.equal(searchKey(h), undefined);
    process.env.TAVILY_API_KEY = "tvly-env";
    assert.equal(searchKey(h), "tvly-env");

    setSearchKey(h, " tvly-saved ");
    assert.equal(searchKey(h), "tvly-saved");
    const m = addModel(h, { model: "deepseek-chat", apiKey: "sk-aaaa1111" });
    setActiveModel(h, null);
    setActiveModel(h, m.id);
    removeModel(h, m.id);
    assert.equal(loadSettings(h).tavilyApiKey, "tvly-saved");
    assert.equal(statSync(settingsPath(h)).mode & 0o777, 0o600);

    assert.throws(() => setSearchKey(h, "  "), /API key/);
    setSearchKey(h, null);
    assert.equal(loadSettings(h).tavilyApiKey, undefined);
    assert.equal(searchKey(h), "tvly-env");
  } finally {
    if (prev === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = prev;
  }
});

test("settings: a model can be marked as reading images; unmarked and odd values read as false", () => {
  const h = home();
  const a = addModel(h, { model: "gpt-4o", apiKey: "sk-aaaa1111", vision: true });
  const b = addModel(h, { model: "deepseek-chat", apiKey: "sk-bbbb2222" });
  assert.equal(activeModel(h)?.vision, true);
  assert.equal(loadSettings(h).models.find((m) => m.id === b.id)?.vision, undefined);

  setModelVision(h, b.id, true);
  setModelVision(h, a.id, false);
  assert.deepEqual(
    loadSettings(h).models.map((m) => [m.model, m.vision]),
    [
      ["gpt-4o", undefined],
      ["deepseek-chat", true],
    ],
  );
  assert.equal(statSync(settingsPath(h)).mode & 0o777, 0o600);
  assert.throws(() => setModelVision(h, "nope", true), /no model/);

  writeFileSync(settingsPath(h), JSON.stringify({ models: [{ id: "x", model: "m", apiKey: "k", vision: "yes" }] }));
  assert.deepEqual(loadSettings(h).models, [{ id: "x", model: "m", apiKey: "k" }]);
});

test("settings: default base URL follows the model name; key hint hides the key", () => {
  assert.equal(defaultBaseURL("deepseek-reasoner"), "https://api.deepseek.com/v1");
  assert.equal(defaultBaseURL("gpt-4o-mini"), "https://api.openai.com/v1");
  assert.equal(keyHint("sk-abcdefgh1234"), "sk-…1234");
  assert.equal(keyHint("short"), "…");
});
