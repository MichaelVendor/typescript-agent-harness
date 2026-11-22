import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./save.ts";
import { MAX_TARGETS, type Brief } from "./schema.ts";
import type { TargetRef } from "./targets.ts";

export type Subscription = {
  id: string;
  enabled: boolean;
  template: "ops" | "exec";
  targets: TargetRef[];
  note?: string;
  updatedAt: string;
};

export type SubscriptionsFile = {
  version: 1;
  subscriptions: Subscription[];
};

let pathOverride: string | null = null;

/** 仅测试用。 */
export function setSubscriptionsPathForTest(file: string | null): void {
  pathOverride = file;
}

export function resolveSubscriptionsPath(): string {
  return pathOverride ?? path.join(PROJECT_ROOT, "out", "subscriptions.json");
}

function emptyFile(): SubscriptionsFile {
  return { version: 1, subscriptions: [] };
}

export function loadSubscriptions(filePath?: string): SubscriptionsFile {
  const p = filePath ?? resolveSubscriptionsPath();
  if (!existsSync(p)) return emptyFile();
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as SubscriptionsFile;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.subscriptions)) return emptyFile();
    return raw;
  } catch {
    return emptyFile();
  }
}

export function saveSubscriptions(file: SubscriptionsFile, filePath?: string): string {
  const p = filePath ?? resolveSubscriptionsPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return p;
}

function normalizeTargets(targets: TargetRef[]): TargetRef[] {
  return targets.slice(0, MAX_TARGETS).map((t, i) => {
    const id = t.id?.trim() || t.asin?.trim() || `t${i + 1}`;
    const ref: TargetRef = { id };
    if (t.url) ref.url = t.url;
    if (t.asin) ref.asin = t.asin;
    if (t.title) ref.title = t.title;
    if (t.query) ref.query = t.query;
    return ref;
  });
}

export function upsertSubscription(input: {
  id?: string;
  targets: TargetRef[];
  template?: "ops" | "exec";
  enabled?: boolean;
  note?: string;
  now?: Date;
}): { filePath: string; subscription: Subscription } {
  if (!input.targets.length) throw new Error("targets required");
  const file = loadSubscriptions();
  const now = (input.now ?? new Date()).toISOString();
  const id = (input.id?.trim() || `sub-${now.replace(/[:.]/g, "-")}`).slice(0, 80);
  const subscription: Subscription = {
    id,
    enabled: input.enabled !== false,
    template: input.template === "exec" ? "exec" : "ops",
    targets: normalizeTargets(input.targets),
    updatedAt: now,
    ...(input.note ? { note: input.note } : {}),
  };
  const idx = file.subscriptions.findIndex((s) => s.id === id);
  if (idx >= 0) file.subscriptions[idx] = subscription;
  else file.subscriptions.push(subscription);
  const filePath = saveSubscriptions(file);
  return { filePath, subscription };
}

export function listEnabledSubscriptions(filePath?: string): Subscription[] {
  return loadSubscriptions(filePath).subscriptions.filter((s) => s.enabled && s.targets.length > 0);
}

export type WeeklyRunResult = {
  subscriptionId: string;
  ok: boolean;
  mdPath?: string;
  jsonPath?: string;
  error?: string;
  brief?: Brief;
  notify?: Array<{ channel: string; ok: boolean; detail: string }>;
};
