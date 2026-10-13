import type { SettingsView } from "@typescript-agent-harness/cli";

type Model = SettingsView["models"][number];

const KNOWN: Record<string, string> = { "api.deepseek.com": "DeepSeek", "api.openai.com": "OpenAI" };

/** "DeepSeek" / "OpenAI" for their official endpoints, otherwise the host. */
export function providerName(baseURL: string): string {
  let host: string;
  try {
    host = new URL(baseURL).host;
  } catch {
    return baseURL;
  }
  return KNOWN[host] ?? host;
}

/** Saved models grouped by provider, groups and models in the order they were added. */
export function groupModels(models: Model[]): { name: string; models: Model[] }[] {
  const groups: { name: string; models: Model[] }[] = [];
  for (const m of models) {
    const name = providerName(m.baseURL);
    const group = groups.find((g) => g.name === name);
    if (group) group.models.push(m);
    else groups.push({ name, models: [m] });
  }
  return groups;
}

/** What the composer's model button reads. */
export function modelLabel(view: SettingsView): string {
  const active = view.models.find((m) => m.id === view.activeModel);
  if (active) return active.model;
  return view.env ? `${view.env.model} · .env` : "No model";
}
