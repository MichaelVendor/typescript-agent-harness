import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { keyHint } from "./settings.js";

export type ConnectorAccount = {
  id: string;
  provider: "telegram" | "slack" | "feishu" | string;
  authKind: "token";
  label?: string;
  keyHint: string;
};

type StoredConnector = Omit<ConnectorAccount, "keyHint"> & { token: string };
type ConnectorsFile = { accounts: StoredConnector[] };

function connectorsPath(home: string): string {
  return path.join(home, ".tah", "connectors.json");
}

function readStored(home: string): ConnectorsFile {
  const file = connectorsPath(home);
  if (!existsSync(file)) return { accounts: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { accounts?: unknown };
    const accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).filter(
      (account): account is StoredConnector =>
        typeof account?.id === "string" &&
        typeof account.provider === "string" &&
        account.authKind === "token" &&
        typeof account.token === "string" &&
        (account.label === undefined || typeof account.label === "string"),
    );
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

function publicAccount(account: StoredConnector): ConnectorAccount {
  const { token, ...rest } = account;
  return { ...rest, keyHint: keyHint(token) };
}

export function loadConnectors(home: string): { accounts: ConnectorAccount[] } {
  return { accounts: readStored(home).accounts.map(publicAccount) };
}

export function upsertConnectorToken(
  home: string,
  input: { id?: string; provider: string; token: string; label?: string },
): ConnectorAccount {
  const provider = input.provider.trim();
  const token = input.token.trim();
  if (!provider) throw new Error("provider is required");
  if (!token) throw new Error("token is required");
  const id = input.id?.trim() || `c_${randomBytes(4).toString("hex")}`;
  const label = input.label?.trim();
  const account: StoredConnector = {
    id,
    provider,
    authKind: "token",
    ...(label ? { label } : {}),
    token,
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
  return readStored(home).accounts.find((account) => account.id === id)?.token;
}
