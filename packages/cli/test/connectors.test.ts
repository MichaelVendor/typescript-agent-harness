import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  githubReviewToken,
  loadConnectors,
  readConnectorSecret,
  removeConnector,
  upsertConnectorOAuth,
  upsertConnectorToken,
} from "../dist/connectors.js";

test("connectors: upsert exposes only a hint and stores a private secret", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-connectors-"));
  const account = upsertConnectorToken(home, {
    provider: "telegram",
    token: "123456:AAAsecretTOKEN",
    label: "Bot",
  });

  assert.deepEqual(loadConnectors(home), { accounts: [account] });
  assert.equal("token" in account, false);
  assert.equal(account.keyHint, "123…OKEN");
  assert.equal(readConnectorSecret(home, account.id), "123456:AAAsecretTOKEN");

  const file = path.join(home, ".tah", "connectors.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.match(readFileSync(file, "utf8"), /AAAsecretTOKEN/);
});

test("connectors: an id can be updated and removed", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-connectors-"));
  upsertConnectorToken(home, { id: "telegram.botToken", provider: "telegram", token: "first-token" });
  const updated = upsertConnectorToken(home, {
    id: "telegram.botToken",
    provider: "telegram",
    token: "second-token",
  });

  assert.equal(loadConnectors(home).accounts.length, 1);
  assert.equal(readConnectorSecret(home, updated.id), "second-token");
  removeConnector(home, updated.id);
  assert.deepEqual(loadConnectors(home), { accounts: [] });
  assert.equal(readConnectorSecret(home, updated.id), undefined);
});

test("connectors: oauth stores secrets privately and readConnectorSecret returns accessToken", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-connectors-"));
  const account = upsertConnectorOAuth(home, {
    provider: "github",
    accessToken: "gho_myAccessTokenSecret",
    refreshToken: "ghr_refreshSecret",
    expiresAt: 1_900_000_000,
    scopes: ["repo", "read:user"],
    label: "GH",
  });

  assert.equal(account.authKind, "oauth");
  assert.equal(account.keyHint, "gho…cret");
  assert.deepEqual(loadConnectors(home), { accounts: [account] });
  assert.equal(readConnectorSecret(home, account.id), "gho_myAccessTokenSecret");

  const file = path.join(home, ".tah", "connectors.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const raw = readFileSync(file, "utf8");
  assert.match(raw, /gho_myAccessTokenSecret/);
  assert.match(raw, /ghr_refreshSecret/);
  const pub = loadConnectors(home).accounts[0]!;
  assert.equal("accessToken" in pub, false);
  assert.equal("refreshToken" in pub, false);
});

test("githubReviewToken: oauth github.oauth then PAT token account", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-connectors-"));
  assert.equal(githubReviewToken(home), undefined);
  upsertConnectorToken(home, { id: "github.pat", provider: "github", token: "ghp_patOnly" });
  assert.equal(githubReviewToken(home), "ghp_patOnly");
  upsertConnectorOAuth(home, {
    id: "github.oauth",
    provider: "github",
    accessToken: "gho_oauthWins",
  });
  assert.equal(githubReviewToken(home), "gho_oauthWins");
  removeConnector(home, "github.oauth");
  assert.equal(githubReviewToken(home), "ghp_patOnly");
});

test("connectors: token and oauth accounts coexist", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-connectors-"));
  upsertConnectorToken(home, { id: "t1", provider: "telegram", token: "tok-abc" });
  upsertConnectorOAuth(home, { id: "o1", provider: "github", accessToken: "gho_xyz" });
  const loaded = loadConnectors(home);
  assert.equal(loaded.accounts.length, 2);
  assert.equal(readConnectorSecret(home, "t1"), "tok-abc");
  assert.equal(readConnectorSecret(home, "o1"), "gho_xyz");
});
