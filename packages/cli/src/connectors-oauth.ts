import { randomBytes } from "node:crypto";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_SCOPES = "read:user repo";

const DEFAULT_FEISHU_OAUTH_HOST = "open.feishu.cn";

function feishuAccountsHost(oauthHost: string): string {
  return oauthHost.startsWith("open.") ? `accounts.${oauthHost.slice("open.".length)}` : oauthHost;
}

function feishuAuthorizeBase(oauthHost: string = DEFAULT_FEISHU_OAUTH_HOST): string {
  return `https://${feishuAccountsHost(oauthHost)}/open-apis/authen/v1/authorize`;
}

function feishuTokenUrl(oauthHost: string = DEFAULT_FEISHU_OAUTH_HOST): string {
  return `https://${feishuAccountsHost(oauthHost)}/oauth/v3/token`;
}

export type OAuthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createGithubOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildGithubOAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", GITHUB_SCOPES);
  return url.toString();
}

export async function exchangeGithubOAuthCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: OAuthFetch = fetch,
): Promise<{ accessToken: string; scopes: string[] }> {
  const response = await fetchImpl(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const body = (await response.json().catch(() => undefined)) as
    | { access_token?: unknown; scope?: unknown; error?: unknown; error_description?: unknown }
    | undefined;
  if (!response.ok || typeof body?.access_token !== "string" || !body.access_token) {
    const detail =
      typeof body?.error_description === "string"
        ? body.error_description
        : typeof body?.error === "string"
          ? body.error
          : `GitHub token exchange failed (${response.status})`;
    throw new Error(detail);
  }
  const scopes =
    typeof body.scope === "string"
      ? body.scope.split(",").map((scope) => scope.trim()).filter(Boolean)
      : [];
  return { accessToken: body.access_token, scopes };
}

export function resolveFeishuOAuthCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { clientId: string; clientSecret: string; host: string } | null {
  const clientId = env.TAH_FEISHU_CLIENT_ID || env.FEISHU_APP_ID;
  const clientSecret = env.TAH_FEISHU_CLIENT_SECRET || env.FEISHU_APP_SECRET;
  const host = env.TAH_FEISHU_OAUTH_HOST || DEFAULT_FEISHU_OAUTH_HOST;
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret, host };
}

export function buildFeishuOAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  host?: string;
}): string {
  const url = new URL(feishuAuthorizeBase(input.host ?? DEFAULT_FEISHU_OAUTH_HOST));
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

function feishuTokenExchangeError(
  body:
    | {
        error?: unknown;
        error_description?: unknown;
        msg?: unknown;
        message?: unknown;
      }
    | undefined,
  status: number,
): string {
  if (typeof body?.error_description === "string") {
    return body.error_description;
  }
  if (typeof body?.msg === "string") {
    return body.msg;
  }
  if (typeof body?.message === "string") {
    return body.message;
  }
  if (typeof body?.error === "string") {
    return body.error;
  }
  return `Feishu token exchange failed (${status})`;
}

function parseFeishuScopes(scope: unknown): string[] {
  if (typeof scope !== "string" || !scope.trim()) {
    return [];
  }
  return scope.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
}

export async function exchangeFeishuOAuthCode(
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    host?: string;
  },
  fetchImpl: OAuthFetch = fetch,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[] }> {
  const oauthHost = input.host ?? DEFAULT_FEISHU_OAUTH_HOST;
  const response = await fetchImpl(feishuTokenUrl(oauthHost), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const body = (await response.json().catch(() => undefined)) as
    | {
        access_token?: unknown;
        refresh_token?: unknown;
        expires_in?: unknown;
        scope?: unknown;
        error?: unknown;
        error_description?: unknown;
        msg?: unknown;
        message?: unknown;
      }
    | undefined;
  if (!response.ok || typeof body?.access_token !== "string" || !body.access_token) {
    throw new Error(feishuTokenExchangeError(body, response.status));
  }
  const scopes = parseFeishuScopes(body.scope);
  const result: { accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[] } = {
    accessToken: body.access_token,
    scopes,
  };
  if (typeof body.refresh_token === "string" && body.refresh_token) {
    result.refreshToken = body.refresh_token;
  }
  if (typeof body.expires_in === "number" && Number.isFinite(body.expires_in)) {
    result.expiresAt = Date.now() + body.expires_in * 1000;
  }
  return result;
}
