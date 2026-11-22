import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  loadConnectors,
  readConnectorSecret,
  removeConnector,
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
