import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { keyHint } from "./settings.js";

export type ConnectorAccount = {
  id: string;
  provider: "telegram" | "slack" | "feishu" | string;
  authKind: "token" | "oauth";
  label?: string;
  keyHint: string;
  /** Self-hosted GitLab origin when stored on a gitlab PAT connector. */
  host?: string;
};

type StoredTokenConnector = {
  id: string;
  provider: string;
  authKind: "token";
  label?: string;
  token: string;
  host?: string;
};

type StoredOAuthConnector = {
  id: string;
  provider: string;
  authKind: "oauth";
  label?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
};

type StoredConnector = StoredTokenConnector | StoredOAuthConnector;
type ConnectorsFile = { accounts: StoredConnector[] };

function connectorsPath(home: string): string {
  return path.join(home, ".tah", "connectors.json");
}

function isStoredConnector(account: unknown): account is StoredConnector {
  if (!account || typeof account !== "object") return false;
  const a = account as Record<string, unknown>;
  if (typeof a.id !== "string" || typeof a.provider !== "string") return false;
  if (a.label !== undefined && typeof a.label !== "string") return false;
  if (a.authKind === "token") {
    if (typeof a.token !== "string") return false;
    if (a.host !== undefined && typeof a.host !== "string") return false;
    return true;
  }
  if (a.authKind === "oauth") {
    if (typeof a.accessToken !== "string") return false;
    if (a.refreshToken !== undefined && typeof a.refreshToken !== "string") return false;
    if (a.expiresAt !== undefined && typeof a.expiresAt !== "number") return false;
    if (a.scopes !== undefined && !Array.isArray(a.scopes)) return false;
    if (Array.isArray(a.scopes) && !a.scopes.every((s) => typeof s === "string")) return false;
    return true;
  }
  return false;
}

function readStored(home: string): ConnectorsFile {
  const file = connectorsPath(home);
  if (!existsSync(file)) return { accounts: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { accounts?: unknown };
    const accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).filter(isStoredConnector);
    return { accounts };
  } catch {
    return { accounts: [] };
  }
}

function writeStored(home: string, data: ConnectorsFile): void {
  const file = connectorsPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function secretOf(account: StoredConnector): string {
  return account.authKind === "token" ? account.token : account.accessToken;
}

function publicAccount(account: StoredConnector): ConnectorAccount {
  const hint = keyHint(secretOf(account));
  if (account.authKind === "token") {
    const { token: _t, ...rest } = account;
    return { ...rest, keyHint: hint };
  }
  const { accessToken: _a, refreshToken: _r, expiresAt: _e, scopes: _s, ...rest } = account;
  return { ...rest, keyHint: hint };
}

export function loadConnectors(home: string): { accounts: ConnectorAccount[] } {
  return { accounts: readStored(home).accounts.map(publicAccount) };
}

export function upsertConnectorToken(
  home: string,
  input: { id?: string; provider: string; token: string; label?: string; host?: string | null },
): ConnectorAccount {
  const provider = input.provider.trim();
  const token = input.token.trim();
  if (!provider) throw new Error("provider is required");
  if (!token) throw new Error("token is required");
  const id = input.id?.trim() || `c_${randomBytes(4).toString("hex")}`;
  const label = input.label?.trim();
  const data = readStored(home);
  const index = data.accounts.findIndex((item) => item.id === id);
  const prev = index === -1 ? undefined : data.accounts[index];
  const hostRaw = input.host;
  const host =
    hostRaw === null
      ? undefined
      : hostRaw !== undefined
        ? hostRaw.trim() || undefined
        : prev && prev.authKind === "token"
          ? prev.host
          : undefined;
  const account: StoredTokenConnector = {
    id,
    provider,
    authKind: "token",
    ...(label ? { label } : {}),
    token,
    ...(host ? { host } : {}),
  };
  if (index === -1) data.accounts.push(account);
  else data.accounts[index] = account;
  writeStored(home, data);
  return publicAccount(account);
}

export type UpsertConnectorOAuthInput = {
  id?: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  label?: string;
};

export function upsertConnectorOAuth(home: string, input: UpsertConnectorOAuthInput): ConnectorAccount {
  const provider = input.provider.trim();
  const accessToken = input.accessToken.trim();
  if (!provider) throw new Error("provider is required");
  if (!accessToken) throw new Error("accessToken is required");
  const id = input.id?.trim() || `c_${randomBytes(4).toString("hex")}`;
  const label = input.label?.trim();
  const refreshToken = input.refreshToken?.trim();
  const account: StoredOAuthConnector = {
    id,
    provider,
    authKind: "oauth",
    ...(label ? { label } : {}),
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    ...(input.scopes?.length ? { scopes: [...input.scopes] } : {}),
  };
  const data = readStored(home);
  const index = data.accounts.findIndex((item) => item.id === id);
  if (index === -1) data.accounts.push(account);
  else data.accounts[index] = account;
  writeStored(home, data);
  return publicAccount(account);
}

export function removeConnector(home: string, id: string): void {
  const data = readStored(home);
  writeStored(home, { accounts: data.accounts.filter((account) => account.id !== id) });
}

export function readConnectorSecret(home: string, id: string): string | undefined {
  const account = readStored(home).accounts.find((item) => item.id === id);
  if (!account) return undefined;
  return secretOf(account);
}

/** GitHub PR review: oauth account first, then PAT token connector for provider github. */
export function githubReviewToken(home: string): string | undefined {
  const oauth = readConnectorSecret(home, "github.oauth");
  if (oauth) return oauth;
  const pat = readStored(home).accounts.find(
    (account) => account.provider === "github" && account.authKind === "token",
  );
  return pat ? secretOf(pat) : undefined;
}

/** GitLab MR review: PAT token connector for provider gitlab, then env GITLAB_TOKEN. */
export function gitlabReviewToken(home: string): string | undefined {
  const accounts = readStored(home).accounts;
  const pat =
    accounts.find((account) => account.id === "gitlab.pat" && account.authKind === "token") ??
    accounts.find((account) => account.provider === "gitlab" && account.authKind === "token");
  if (pat) return secretOf(pat);
  const env = process.env.GITLAB_TOKEN?.trim();
  return env || undefined;
}

export function resolveGitlabHost(env: NodeJS.ProcessEnv = process.env, home?: string): string {
  if (home) {
    const stored = readStored(home).accounts.find(
      (account) => account.id === "gitlab.pat" && account.authKind === "token" && account.host?.trim(),
    );
    if (stored?.authKind === "token" && stored.host) {
      return stored.host.replace(/\/$/, "");
    }
  }
  const host = env.GITLAB_HOST?.trim();
  return host?.replace(/\/$/, "") || "https://gitlab.com";
}