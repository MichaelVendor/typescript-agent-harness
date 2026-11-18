import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type LLMRequest, type LLMResponse, type LLMService } from "@typescript-agent-harness/llm";
import { PERMISSIONS, permissionsPlugin } from "@typescript-agent-harness/permissions";
import { toolsPlugin } from "@typescript-agent-harness/tools";
import {
  createSuperAgent,
  matchesTicketStatusSubsequence,
  type RouterAction,
  type SuperAgentEvent,
  type WorkerReport,
} from "../src/super-agent.ts";
import {
  SUPER_AGENT_ROUTER_DENIED_TOOLS,
  createSessionSuperAgentRunners,
  parseRouterAction,
  parseWorkerReport,
} from "../src/super-agent-session.ts";
import { createMockGitHubSource } from "../src/super-agent-source.ts";

test("mock：user → spawn → worker done → reply", async () => {
  let routerCalls = 0;
  const sa = createSuperAgent({
    defaultMandate: { scope: "demo", policyVersion: "s1" },
    async routerDecide({ event }): Promise<RouterAction> {
      routerCalls += 1;
      if (event.kind === "user_message") {
        return { type: "spawn_ticket", goal: event.text, threadId: "github:pr/1" };
      }
      if (event.kind === "worker_report" && event.done) {
        return { type: "reply", text: `已完成：${event.text}` };
      }
      return { type: "reply", text: "ok" };
    },
    async workerRun(): Promise<WorkerReport> {
      return { text: "PR 草稿已开", done: true };
    },
  });

  sa.ingest({ kind: "user_message", text: "修登录 bug" });
  assert.equal(sa.meta.status, "router");

  const r1 = await sa.step();
  assert.equal(r1?.phase, "router");
  assert.equal(sa.meta.status, "worker_running");
  assert.equal(sa.tickets()[0]?.status, "running");

  const r2 = await sa.step();
  assert.equal(r2?.phase, "worker");
  assert.equal(sa.tickets()[0]?.status, "done");

  const r3 = await sa.step();
  assert.equal(r3?.phase, "router");
  assert.equal(sa.replies()[0], "已完成：PR 草稿已开");
  assert.equal(sa.meta.status, "idle");
  assert.ok(routerCalls >= 2);
  assert.ok(
    matchesTicketStatusSubsequence(sa.tickets(), [
      { goalIncludes: "登录", status: "done" },
    ]),
  );
});

test("订阅：同 thread 的 source_event 不经 Router", async () => {
  let routerCalls = 0;
  let workerMail: SuperAgentEvent[] = [];
  const sa = createSuperAgent({
    defaultMandate: { scope: "demo", policyVersion: "s1" },
    async routerDecide({ event }): Promise<RouterAction> {
      routerCalls += 1;
      if (event.kind === "user_message") {
        return { type: "spawn_ticket", goal: event.text, threadId: "github:pr/9" };
      }
      if (event.kind === "worker_report") {
        return { type: "reply", text: event.text };
      }
      return { type: "reply", text: `unexpected:${event.kind}` };
    },
    async workerRun({ mailbox }): Promise<WorkerReport> {
      workerMail = [...mailbox];
      if (mailbox.some((e) => e.kind === "source_event")) {
        return { text: "已根据评论修改", done: true };
      }
      return { text: "等待评论", done: false };
    },
  });

  sa.ingest({ kind: "user_message", text: "开 PR" });
  await sa.step(); // spawn
  const afterSpawnRouter = routerCalls;
  await sa.step(); // worker first pass (no mail) → still running

  sa.ingest({
    kind: "source_event",
    source: "github",
    threadId: "github:pr/9",
    text: "请补测试",
  });
  assert.equal(routerCalls, afterSpawnRouter, "订阅投递不应增加 Router 调用");

  await sa.step(); // worker with mailbox
  assert.ok(workerMail.some((e) => e.kind === "source_event"));
  await sa.step(); // router reply on worker_report
  assert.match(sa.replies().join("\n"), /已根据评论修改/);
});

test("工单 done 后同 thread 事件进 Router，不被订阅吞掉", async () => {
  let routerSawSource = 0;
  const sa = createSuperAgent({
    defaultMandate: { scope: "demo", policyVersion: "s2" },
    async routerDecide({ event }): Promise<RouterAction> {
      if (event.kind === "user_message") {
        return { type: "spawn_ticket", goal: event.text, threadId: "tg:chat/1" };
      }
      if (event.kind === "source_event") {
        routerSawSource += 1;
        return { type: "reply", text: `闲聊：${event.text}` };
      }
      if (event.kind === "worker_report") return { type: "reply", text: `DONE：${event.text}` };
      return { type: "reply", text: "ok" };
    },
    async workerRun(): Promise<WorkerReport> {
      return { text: "ok", done: true };
    },
  });
  sa.ingest({ kind: "user_message", text: "先做一单" });
  await sa.step();
  await sa.step();
  await sa.step();
  assert.equal(sa.tickets()[0]?.status, "done");
  assert.equal(sa.reviewPanel().subscriptions.length, 0);

  sa.ingest({
    kind: "source_event",
    source: "telegram",
    threadId: "tg:chat/1",
    text: "你是谁",
  });
  await sa.step();
  assert.equal(routerSawSource, 1);
  assert.match(sa.replies().join("\n"), /闲聊：你是谁/);
});

test("parseRouterAction / parseWorkerReport", () => {
  assert.equal(parseRouterAction('{"type":"reply","text":"hi"}').type, "reply");
  assert.equal(parseWorkerReport('```json\n{"text":"ok","done":true}\n```').done, true);
});

test("persist 快照 + restore", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sa-persist-"));
  const sa = createSuperAgent({
    persistDir: dir,
    defaultMandate: { id: "m1", scope: "demo", policyVersion: "s2" },
    async routerDecide({ event }): Promise<RouterAction> {
      if (event.kind === "user_message") {
        return { type: "spawn_ticket", goal: event.text, threadId: "github:pr/persist" };
      }
      return { type: "reply", text: "later" };
    },
    async workerRun(): Promise<WorkerReport> {
      return { text: "working", done: false };
    },
  });
  sa.ingest({ kind: "user_message", text: "持久化工单" });
  await sa.step();
  await sa.step();
  assert.ok(existsSync(path.join(dir, "tickets.json")));
  assert.ok(existsSync(path.join(dir, "mandates.json")));
  assert.ok(existsSync(path.join(dir, "panel.json")));
  const tickets = JSON.parse(readFileSync(path.join(dir, "tickets.json"), "utf8")) as { status: string }[];
  assert.equal(tickets[0]?.status, "running");

  const restored = createSuperAgent({
    persistDir: dir,
    restore: true,
    async routerDecide() {
      return { type: "reply", text: "noop" };
    },
    async workerRun() {
      return { text: "noop", done: true };
    },
  });
  assert.equal(restored.tickets()[0]?.status, "running");
  assert.equal(restored.mandates()[0]?.id, "m1");
  assert.equal(restored.meta.status, "worker_running");
});

test("Watchdog：超时 running → failed", async () => {
  const sa = createSuperAgent({
    ticketTimeoutMs: 10,
    defaultMandate: { scope: "demo", policyVersion: "s2" },
    async routerDecide({ event }): Promise<RouterAction> {
      if (event.kind === "user_message") {
        return { type: "spawn_ticket", goal: event.text };
      }
      if (event.kind === "worker_report") {
        return { type: "reply", text: `ack:${event.text}` };
      }
      return { type: "reply", text: "ok" };
    },
    async workerRun(): Promise<WorkerReport> {
      return { text: "still going", done: false };
    },
  });
  sa.ingest({ kind: "user_message", text: "慢任务" });
  await sa.step(); // spawn
  await sa.step(); // worker still running
  assert.equal(sa.tickets()[0]?.status, "running");

  const timed = sa.watch(Date.now() + 1000);
  assert.equal(timed.length, 1);
  assert.equal(sa.tickets()[0]?.status, "failed");
  assert.match(sa.tickets()[0]?.failReason ?? "", /watchdog/);

  const out = await sa.step();
  assert.ok(out?.phase === "router" || out?.phase === "watchdog");
});

test("Worker throw → ticket failed", async () => {
  const sa = createSuperAgent({
    defaultMandate: { scope: "demo", policyVersion: "s2" },
    async routerDecide({ event }): Promise<RouterAction> {
      if (event.kind === "user_message") return { type: "spawn_ticket", goal: event.text };
      if (event.kind === "worker_report") return { type: "reply", text: `失败收口：${event.text}` };
      return { type: "reply", text: "ok" };
    },
    async workerRun(): Promise<WorkerReport> {
      throw new Error("disk full");
    },
  });
  sa.ingest({ kind: "user_message", text: "会炸" });
  await sa.step();
  const w = await sa.step();
  assert.equal(w?.phase, "worker");
  assert.equal(sa.tickets()[0]?.status, "failed");
  assert.match(sa.tickets()[0]?.failReason ?? "", /disk full/);
  await sa.step();
  assert.match(sa.replies().join("\n"), /失败收口/);
});

test("reviewPanel 人审只读形状", async () => {
  const sa = createSuperAgent({
    defaultMandate: { scope: "demo", policyVersion: "s3" },
    async routerDecide(): Promise<RouterAction> {
      return { type: "ask_human", text: "要不要改生产？" };
    },
    async workerRun(): Promise<WorkerReport> {
      return { text: "n/a", done: true };
    },
  });
  sa.ingest({ kind: "user_message", text: "改生产" });
  await sa.step();
  const panel = sa.reviewPanel();
  assert.equal(panel.status, "needs_human");
  assert.ok(panel.recentReplies.some((r) => r.includes("要不要改生产")));
  assert.equal(panel.agentId, sa.id);
});

test("mock GitHub Source → 订阅直达", async () => {
  const gh = createMockGitHubSource();
  let sawComment = false;
  const sa = createSuperAgent({
    defaultMandate: { scope: "demo", policyVersion: "s3" },
    async routerDecide({ event }): Promise<RouterAction> {
      if (event.kind === "user_message") {
        return { type: "spawn_ticket", goal: event.text, threadId: "issue:42" };
      }
      if (event.kind === "worker_report") return { type: "reply", text: event.text };
      return { type: "reply", text: "unexpected source via router" };
    },
    async workerRun({ mailbox }): Promise<WorkerReport> {
      if (mailbox.some((e) => e.kind === "source_event")) {
        sawComment = true;
        return { text: "已按 Issue 评论改", done: true };
      }
      return { text: "等评论", done: false };
    },
  });
  sa.ingest({ kind: "user_message", text: "跟 Issue 42" });
  await sa.step();
  await sa.step();
  sa.ingest(
    gh.toSourceEvent({
      threadId: "issue:42",
      body: "请加回归测试",
      author: "reviewer",
      kind: "issue",
    }),
  );
  await sa.step();
  await sa.step();
  assert.equal(sawComment, true);
  assert.match(sa.replies().join("\n"), /已按 Issue/);
});

test("SUPER_AGENT_ROUTER_DENIED_TOOLS + permissions 拦截写工具", async () => {
  const stub: LLMService = {
    async generate(): Promise<LLMResponse> {
      return {
        id: "r",
        model: "stub",
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      };
    },
    async *stream() {
      const response = await stub.generate({ messages: [] });
      yield { type: "done", response };
    },
  };
  const runtime = new Runtime({ id: "router-deny" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, stub) })
    .use(toolsPlugin())
    .use(permissionsPlugin({ deny: [...SUPER_AGENT_ROUTER_DENIED_TOOLS] }))
    .use(agentPlugin({ maxSteps: 2 }));
  await runtime.start();
  const perms = runtime.get(PERMISSIONS);
  assert.equal(perms.check("write_file", {}).allow, false);
  assert.equal(perms.check("execute_command", {}).allow, false);
  assert.equal(perms.check("edit_file", {}).allow, false);
  assert.equal(perms.check("read_file", {}).allow, true);
  await runtime.stop();
});

test("createSessionSuperAgentRunners 经真 Session.run", async () => {
  const llm: LLMService = {
    async generate(request: LLMRequest): Promise<LLMResponse> {
      const last = [...request.messages].reverse().find((m) => m.role === "user");
      const user = typeof last?.content === "string" ? last.content : "";
      let content: string;
      if (user.includes("You are the Super-agent Router")) {
        if (user.includes("[worker_report")) {
          content = JSON.stringify({ type: "reply", text: "对外：已修好" });
        } else {
          content = JSON.stringify({
            type: "spawn_ticket",
            goal: "修登录",
            threadId: "github:pr/2",
          });
        }
      } else {
        content = JSON.stringify({ text: "补丁已提交", done: true });
      }
      return {
        id: "r",
        model: "stub",
        message: { role: "assistant", content },
        finishReason: "stop",
      };
    },
    async *stream(request) {
      const response = await llm.generate(request);
      yield { type: "text-delta", text: response.message.content ?? "" };
      yield { type: "done", response };
    },
  };

  const runtime = new Runtime({ id: "super-agent-session" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, llm) })
    .use(toolsPlugin())
    .use(agentPlugin({ maxSteps: 4 }));
  await runtime.start();

  const runners = createSessionSuperAgentRunners({ sessions: runtime.get(SESSION) });
  const sa = createSuperAgent({
    defaultMandate: { scope: "demo", policyVersion: "s1" },
    ...runners,
  });
  sa.ingest({ kind: "user_message", text: "请修登录" });
  await sa.step();
  await sa.step();
  await sa.step();
  assert.equal(sa.tickets()[0]?.status, "done");
  assert.match(sa.replies().join("\n"), /已修好/);
  await runtime.stop();
});
