import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One OpenAI-compatible model; `baseURL` defaults from the model name (see `defaultBaseURL`); `vision`: it reads images. */
export type ModelEntry = { id: string; model: string; apiKey: string; baseURL?: string; vision?: true };

/** IM bot secrets (Settings → 即时消息); env vars still win when set. */
export type ChannelSecrets = {
  telegramBotToken?: string;
  slackBotToken?: string;
  slackSigningSecret?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuVerificationToken?: string;
};

/** `<home>/.tah/settings.json`; the active model and the search key win over `.env`. */
export type Settings = {
  models: ModelEntry[];
  activeModel?: string;
  tavilyApiKey?: string;
  channels?: ChannelSecrets;
};

function parseChannelSecrets(raw: unknown): ChannelSecrets | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const out: ChannelSecrets = {};
  const keys: (keyof ChannelSecrets)[] = [
    "telegramBotToken",
    "slackBotToken",
    "slackSigningSecret",
    "feishuAppId",
    "feishuAppSecret",
    "feishuVerificationToken",
  ];
  for (const k of keys) {
    const v = c[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function settingsPath(home: string): string {
  return path.join(home, ".tah", "settings.json");
}

export function loadSettings(home: string): Settings {
  const file = settingsPath(home);
  if (!existsSync(file)) return { models: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      models?: unknown;
      activeModel?: unknown;
      tavilyApiKey?: unknown;
      channels?: unknown;
    };
    const models = (Array.isArray(raw?.models) ? raw.models : [])
      .filter(
        (m): m is ModelEntry =>
          typeof m?.id === "string" &&
          typeof m.model === "string" &&
          typeof m.apiKey === "string" &&
          (m.baseURL === undefined || typeof m.baseURL === "string"),
      )
      .map(({ id, model, apiKey, baseURL, vision }) => ({
        id,
        model,
        apiKey,
        ...(baseURL !== undefined ? { baseURL } : {}),
        ...(vision === true ? { vision: true as const } : {}),
      }));
    const active =
      typeof raw?.activeModel === "string" && models.some((m) => m.id === raw.activeModel)
        ? raw.activeModel
        : undefined;
    const tavily =
      typeof raw?.tavilyApiKey === "string" && raw.tavilyApiKey ? { tavilyApiKey: raw.tavilyApiKey } : {};
    const channels = parseChannelSecrets(raw.channels);
    return {
      models,
      ...(active ? { activeModel: active } : {}),
      ...tavily,
      ...(channels ? { channels } : {}),
    };
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

export function addModel(home: string, input: { model: string; apiKey: string; baseURL?: string; vision?: boolean }): ModelEntry {
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  const baseURL = input.baseURL?.trim();
  if (!model) throw new Error("model name is required");
  if (!apiKey) throw new Error("API key is required");
  const entry: ModelEntry = {
    id: `m_${randomBytes(4).toString("hex")}`,
    model,
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(input.vision ? { vision: true as const } : {}),
  };
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

export function setModelVision(home: string, id: string, vision: boolean): void {
  const s = loadSettings(home);
  if (!s.models.some((m) => m.id === id)) throw new Error(`no model "${id}"`);
  const models = s.models.map((m) => {
    if (m.id !== id) return m;
    const { vision: _, ...rest } = m;
    return vision ? { ...rest, vision: true as const } : rest;
  });
  save(home, { ...s, models });
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
