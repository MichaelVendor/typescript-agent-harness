import { randomBytes } from "node:crypto";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_SCOPES = "read:user repo";

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
