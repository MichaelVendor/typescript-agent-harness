import test from "node:test";
import assert from "node:assert/strict";
import { composeDraft } from "./compose.ts";

test("compose marks pending owners", () => {
  const { markdown, pendingOwnerIds } = composeDraft({
    meetingTitle: "站会",
    rows: [
      { id: "a1", kind: "action", text: "改登录页", owner: "李华", due: null, priority: "P1", evidence: "…" },
      { id: "a2", kind: "action", text: "更新帮助文档", owner: null, due: null, priority: null, evidence: "…" },
    ],
    gaps: ["a2 缺负责人"],
  });
  assert.deepEqual(pendingOwnerIds, ["a2"]);
  assert.match(markdown, /待确认/);
  assert.match(markdown, /更新帮助文档/);
});