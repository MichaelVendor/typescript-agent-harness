/**
 * Super-agent S3 eval：固定场景断言工单序 / 订阅 / 失败 / 面板。
 *
 *   node --experimental-strip-types packages/agent/scripts/eval-super-agent.ts
 */
import assert from "node:assert/strict";
import {
  createSuperAgent,
  matchesTicketStatusSubsequence,
  type RouterAction,
  type WorkerReport,
} from "../src/super-agent.ts";
import { createMockGitHubSource } from "../src/super-agent-source.ts";

type Case = { name: string; run: () => Promise<void> };

const cases: Case[] = [
  {
    name: "happy_path_done",
    async run() {
      const sa = createSuperAgent({
        defaultMandate: { scope: "eval", policyVersion: "s3" },
        async routerDecide({ event }): Promise<RouterAction> {
          if (event.kind === "user_message") return { type: "spawn_ticket", goal: event.text };
          if (event.kind === "worker_report") return { type: "reply", text: `ok:${event.text}` };
          return { type: "reply", text: "x" };
        },
        async workerRun(): Promise<WorkerReport> {
          return { text: "patched", done: true };
        },
      });
      sa.ingest({ kind: "user_message", text: "fix A" });
      while (await sa.step()) {
        /* drain */
      }
      assert.ok(matchesTicketStatusSubsequence(sa.tickets(), [{ goalIncludes: "fix A", status: "done" }]));
      assert.match(sa.replies().join("\n"), /ok:patched/);
    },
  },
  {
    name: "github_subscribe_bypass_router",
    async run() {
      const gh = createMockGitHubSource();
      let routerOnSource = 0;
      const sa = createSuperAgent({
        defaultMandate: { scope: "eval", policyVersion: "s3" },
        async routerDecide({ event }): Promise<RouterAction> {
          if (event.kind === "source_event") routerOnSource += 1;
          if (event.kind === "user_message") {
            return { type: "spawn_ticket", goal: event.text, threadId: "pr:1" };
          }
          if (event.kind === "worker_report") return { type: "reply", text: event.text };
          return { type: "reply", text: "x" };
        },
        async workerRun({ mailbox }): Promise<WorkerReport> {
          if (mailbox.some((e) => e.kind === "source_event")) {
            return { text: "addressed review", done: true };
          }
          return { text: "waiting", done: false };
        },
      });
      sa.ingest({ kind: "user_message", text: "open PR" });
      await sa.step();
      await sa.step();
      sa.ingest(gh.toSourceEvent({ threadId: "pr:1", body: "nit", kind: "pull_request" }));
      await sa.step();
      await sa.step();
      assert.equal(routerOnSource, 0);
      assert.match(sa.replies().join("\n"), /addressed review/);
    },
  },
  {
    name: "worker_fail_then_reply",
    async run() {
      const sa = createSuperAgent({
        defaultMandate: { scope: "eval", policyVersion: "s3" },
        async routerDecide({ event }): Promise<RouterAction> {
          if (event.kind === "user_message") return { type: "spawn_ticket", goal: event.text };
          if (event.kind === "worker_report") return { type: "reply", text: `fail:${event.text}` };
          return { type: "reply", text: "x" };
        },
        async workerRun(): Promise<WorkerReport> {
          throw new Error("boom");
        },
      });
      sa.ingest({ kind: "user_message", text: "will fail" });
      while (await sa.step()) {
        /* drain */
      }
      assert.equal(sa.tickets()[0]?.status, "failed");
      assert.ok(matchesTicketStatusSubsequence(sa.tickets(), [{ status: "failed" }]));
      assert.match(sa.replies().join("\n"), /fail:worker failed/);
    },
  },
  {
    name: "needs_human_panel",
    async run() {
      const sa = createSuperAgent({
        defaultMandate: { scope: "eval", policyVersion: "s3" },
        async routerDecide(): Promise<RouterAction> {
          return { type: "ask_human", text: "approve deploy?" };
        },
        async workerRun(): Promise<WorkerReport> {
          return { text: "n/a", done: true };
        },
      });
      sa.ingest({ kind: "user_message", text: "deploy" });
      await sa.step();
      const panel = sa.reviewPanel();
      assert.equal(panel.status, "needs_human");
      assert.ok(panel.recentReplies.some((r) => /approve deploy/.test(r)));
    },
  },
];

let failed = 0;
for (const c of cases) {
  try {
    await c.run();
    console.log(`PASS ${c.name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.name}`, err);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exitCode = 1;
