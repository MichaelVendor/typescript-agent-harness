import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGithubOAuthUrl,
  createGithubOAuthState,
  exchangeGithubOAuthCode,
} from "../dist/connectors-oauth.js";

test("GitHub OAuth builds an authorization URL with callback, state, and scopes", () => {
  const url = new URL(
    buildGithubOAuthUrl({
      clientId: "client-123",
      redirectUri: "http://127.0.0.1:7431/api/connectors/oauth/callback",
      state: "state-123",
    }),
  );

  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:7431/api/connectors/oauth/callback");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("scope"), "read:user repo");
});

test("GitHub OAuth state is URL-safe and unpredictable in length", () => {
  const first = createGithubOAuthState();
  const second = createGithubOAuthState();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("GitHub OAuth exchanges a callback code without exposing the client secret in the URL", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const result = await exchangeGithubOAuthCode(
    {
      clientId: "client-123",
      clientSecret: "secret-456",
      code: "callback-code",
      redirectUri: "http://127.0.0.1:7431/api/connectors/oauth/callback",
    },
    async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ access_token: "gho_token", scope: "repo,read:user", token_type: "bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  assert.equal(request?.url, "https://github.com/login/oauth/access_token");
  assert.equal(request?.url.includes("secret-456"), false);
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    client_id: "client-123",
    client_secret: "secret-456",
    code: "callback-code",
    redirect_uri: "http://127.0.0.1:7431/api/connectors/oauth/callback",
  });
  assert.deepEqual(result, { accessToken: "gho_token", scopes: ["repo", "read:user"] });
});
