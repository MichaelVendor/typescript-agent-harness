import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One OpenAI-compatible model; `baseURL` defaults from the model name (see `defaultBaseURL`). */
export type ModelEntry = { id: string; model: string; apiKey: string; baseURL?: string };

/** `<home>/.tah/settings.json`; the active model and the search key win over `.env`. */
export type Settings = { models: ModelEntry[]; activeModel?: string; tavilyApiKey?: string };

export function settingsPath(home: string): string {
  return path.join(home, ".tah", "settings.json");
}

export function loadSettings(home: string): Settings {
  const file = settingsPath(home);
  if (!existsSync(file)) return { models: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { models?: unknown; activeModel?: unknown; tavilyApiKey?: unknown };
    const models = (Array.isArray(raw?.models) ? raw.models : []).filter(
      (m): m is ModelEntry =>
        typeof m?.id === "string" &&
        typeof m.model === "string" &&
        typeof m.apiKey === "string" &&
        (m.baseURL === undefined || typeof m.baseURL === "string"),
    );
    const active = typeof raw?.activeModel === "string" && models.some((m) => m.id === raw.activeModel) ? raw.activeModel : undefined;
    const tavily = typeof raw?.tavilyApiKey === "string" && raw.tavilyApiKey ? { tavilyApiKey: raw.tavilyApiKey } : {};
    return active ? { models, activeModel: active, ...tavily } : { models, ...tavily };
  } catch {
    // unreadable file: treat as no settings
    return { models: [] };
  }
}

/** Holds API keys: only the owner may read it. */
function save(home: string, settings: Settings): void {
  const file = settingsPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function activeModel(home: string): ModelEntry | undefined {
  const s = loadSettings(home);
  return s.models.find((m) => m.id === s.activeModel);
}

export function addModel(home: string, input: { model: string; apiKey: string; baseURL?: string }): ModelEntry {
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  const baseURL = input.baseURL?.trim();
  if (!model) throw new Error("model name is required");
  if (!apiKey) throw new Error("API key is required");
  const entry: ModelEntry = { id: `m_${randomBytes(4).toString("hex")}`, model, apiKey, ...(baseURL ? { baseURL } : {}) };
  const s = loadSettings(home);
  save(home, { ...s, models: [...s.models, entry], activeModel: s.activeModel ?? entry.id });
  return entry;
}

export function removeModel(home: string, id: string): void {
  const { activeModel, ...s } = loadSettings(home);
  const models = s.models.filter((m) => m.id !== id);
  save(home, activeModel && activeModel !== id ? { ...s, models, activeModel } : { ...s, models });
}

/** `null` goes back to `.env`. */
export function setActiveModel(home: string, id: string | null): void {
  const { activeModel: _, ...s } = loadSettings(home);
  if (id !== null && !s.models.some((m) => m.id === id)) throw new Error(`no model "${id}"`);
  save(home, id === null ? s : { ...s, activeModel: id });
}

/** `null` removes it, so `TAVILY_API_KEY` from `.env` applies again. */
export function setSearchKey(home: string, apiKey: string | null): void {
  const { tavilyApiKey: _, ...s } = loadSettings(home);
  const key = apiKey?.trim();
  if (apiKey !== null && !key) throw new Error("API key is required");
  save(home, key ? { ...s, tavilyApiKey: key } : s);
}

/** Settings first, then `TAVILY_API_KEY`. */
export function searchKey(home: string): string | undefined {
  return loadSettings(home).tavilyApiKey ?? (process.env.TAVILY_API_KEY?.trim() || undefined);
}

export function defaultBaseURL(model: string): string {
  return model.toLowerCase().startsWith("deepseek") ? "https://api.deepseek.com/v1" : "https://api.openai.com/v1";
}

export function keyHint(apiKey: string): string {
  if (apiKey.length < 8) return "…";
  return `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`;
}
