import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFeishuOAuthUrl,
  buildGithubOAuthUrl,
  createGithubOAuthState,
  exchangeFeishuOAuthCode,
  exchangeGithubOAuthCode,
  resolveFeishuOAuthCredentials,
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

test("Feishu OAuth resolves credentials from TAH_* with FEISHU_APP_* fallback", () => {
  assert.equal(resolveFeishuOAuthCredentials({}), null);
  assert.deepEqual(resolveFeishuOAuthCredentials({ FEISHU_APP_ID: "app-id", FEISHU_APP_SECRET: "app-secret" }), {
    clientId: "app-id",
    clientSecret: "app-secret",
    host: "open.feishu.cn",
  });
  assert.deepEqual(
    resolveFeishuOAuthCredentials({
      TAH_FEISHU_CLIENT_ID: "tah-id",
      TAH_FEISHU_CLIENT_SECRET: "tah-secret",
      TAH_FEISHU_OAUTH_HOST: "open.larksuite.com",
    }),
    { clientId: "tah-id", clientSecret: "tah-secret", host: "open.larksuite.com" },
  );
});

test("Feishu OAuth builds an authorization URL with callback, state, and host", () => {
  const feishu = new URL(
    buildFeishuOAuthUrl({
      clientId: "cli_feishu",
      redirectUri: "http://127.0.0.1:7431/api/connectors/oauth/callback",
      state: "state-feishu",
    }),
  );
  assert.equal(feishu.origin + feishu.pathname, "https://accounts.feishu.cn/open-apis/authen/v1/authorize");
  assert.equal(feishu.searchParams.get("client_id"), "cli_feishu");
  assert.equal(feishu.searchParams.get("response_type"), "code");
  assert.equal(feishu.searchParams.get("redirect_uri"), "http://127.0.0.1:7431/api/connectors/oauth/callback");
  assert.equal(feishu.searchParams.get("state"), "state-feishu");
  assert.equal(feishu.searchParams.get("scope"), null);

  const lark = new URL(
    buildFeishuOAuthUrl({
      clientId: "cli_lark",
      redirectUri: "http://127.0.0.1:7431/api/connectors/oauth/callback",
      state: "state-lark",
      host: "open.larksuite.com",
    }),
  );
  assert.equal(lark.origin + lark.pathname, "https://accounts.larksuite.com/open-apis/authen/v1/authorize");
  assert.equal(lark.searchParams.get("client_id"), "cli_lark");
});

test("Feishu OAuth exchanges a callback code via token endpoint", async () => {
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    let request: { url: string; init?: RequestInit } | undefined;
    const result = await exchangeFeishuOAuthCode(
      {
        clientId: "cli_feishu",
        clientSecret: "secret-feishu",
        code: "auth-code",
        redirectUri: "http://127.0.0.1:7431/api/connectors/oauth/callback",
        host: "open.larksuite.com",
      },
      async (url, init) => {
        request = { url: String(url), init };
        return new Response(
          JSON.stringify({
            access_token: "u-at",
            refresh_token: "u-rt",
            expires_in: 7200,
            scope: "contact:user.base offline_access",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    assert.equal(request?.url, "https://accounts.larksuite.com/oauth/v3/token");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      grant_type: "authorization_code",
      client_id: "cli_feishu",
      client_secret: "secret-feishu",
      code: "auth-code",
      redirect_uri: "http://127.0.0.1:7431/api/connectors/oauth/callback",
    });
    assert.deepEqual(result, {
      accessToken: "u-at",
      refreshToken: "u-rt",
      expiresAt: now + 7200 * 1000,
      scopes: ["contact:user.base", "offline_access"],
    });
  } finally {
    Date.now = originalNow;
  }
});

test("Feishu OAuth token exchange surfaces API error messages", async () => {
  await assert.rejects(
    () =>
      exchangeFeishuOAuthCode(
        {
          clientId: "cli_feishu",
          clientSecret: "secret-feishu",
          code: "bad-code",
          redirectUri: "http://127.0.0.1:7431/api/connectors/oauth/callback",
        },
        async () =>
          new Response(JSON.stringify({ msg: "invalid code" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    /invalid code/,
  );
});
