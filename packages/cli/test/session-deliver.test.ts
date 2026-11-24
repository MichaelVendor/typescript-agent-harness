import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DELIVER_TEXT_MAX,
  DeliverValidationError,
  deliverPath,
  drainDelivers,
  enqueueDeliver,
  formatDeliverNotice,
  isSelfDeliver,
  validateDeliverText,
} from "../dist/serve/session-deliver.js";

test("enqueue/drain round-trips per session", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-deliver-"));
  try {
    const item = { fromSessionId: "a", fromTitle: "Alpha", text: "hi", at: 1 };
    enqueueDeliver(cwd, "b", item);
    enqueueDeliver(cwd, "b", { fromSessionId: "c", text: "later", at: 2 });
    enqueueDeliver(cwd, "z", { fromSessionId: "a", text: "other", at: 3 });
    assert.equal(existsSync(deliverPath(cwd)), true);
    assert.deepEqual(drainDelivers(cwd, "b"), [item, { fromSessionId: "c", text: "later", at: 2 }]);
    assert.deepEqual(drainDelivers(cwd, "b"), []);
    assert.deepEqual(drainDelivers(cwd, "z"), [{ fromSessionId: "a", text: "other", at: 3 }]);
    const raw = JSON.parse(readFileSync(deliverPath(cwd), "utf8")) as Record<string, unknown>;
    assert.deepEqual(raw, {});
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("formatDeliverNotice prefers title", () => {
  assert.equal(
    formatDeliverNotice({ fromSessionId: "sess-1", fromTitle: "My chat", text: "ping", at: 0 }),
    "[from «My chat»] ping",
  );
  assert.equal(formatDeliverNotice({ fromSessionId: "sess-1", text: "ping", at: 0 }), "[from «sess-1»] ping");
});

test("validateDeliverText and self checks", () => {
  assert.equal(validateDeliverText("  hello  "), "hello");
  assert.throws(() => validateDeliverText("   "), (err: unknown) => {
    assert.ok(err instanceof DeliverValidationError);
    return true;
  });
  assert.throws(() => validateDeliverText("x".repeat(DELIVER_TEXT_MAX + 1)), DeliverValidationError);
  assert.throws(() => validateDeliverText(42), DeliverValidationError);
  assert.equal(isSelfDeliver("a", "a"), true);
  assert.equal(isSelfDeliver("a", "b"), false);
});