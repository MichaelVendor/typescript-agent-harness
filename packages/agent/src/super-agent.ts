/**
 * Super-agent — 旁路 Router/Worker 编排（不进入 DefaultLoop）。
 * 从 Agent Room 演进：Router 派 Ticket，Worker 隔离执行；Room 代码并行保留。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type MandateId = string;
export type TicketId = string;
export type ThreadId = string;
export type WorkerId = string;

export type Mandate = {
  id: MandateId;
  scope: string;
  budget?: { maxSteps?: number; maxUsd?: number };
  policyVersion: string;
  createdAt: string;
};

export type TicketStatus = "queued" | "running" | "done" | "failed" | "needs_human";

export type Ticket = {
  id: TicketId;
  mandateId: MandateId;
  threadId?: ThreadId;
  goal: string;
  status: TicketStatus;
  workerId?: WorkerId;
  createdAt: string;
  /** Worker 开始跑的时间（Watchdog 用） */
  startedAt?: string;
  lastReport?: string;
  failReason?: string;
};

export type SuperAgentEvent =
  | { kind: "user_message"; text: string; channel?: string }
  | { kind: "source_event"; source: string; threadId: ThreadId; text: string }
  | { kind: "worker_report"; ticketId: TicketId; text: string; done?: boolean };

export type RouterAction =
  | { type: "reply"; text: string }
  | { type: "spawn_ticket"; goal: string; mandateId?: MandateId; threadId?: ThreadId }
  | { type: "ask_human"; text: string };

export type WorkerReport = {
  text: string;
  done?: boolean;
  needsHuman?: boolean;
};

export type SuperAgentStatus = "idle" | "router" | "worker_running" | "needs_human";

export type SuperAgentMeta = {
  id: string;
  status: SuperAgentStatus;
  activeTicketId?: TicketId;
  createdAt: string;
};

/** 人审面板只读快照（S3；serve UI 可后接） */
export type ReviewPanelSnapshot = {
  agentId: string;
  status: SuperAgentStatus;
  needsHuman: Ticket[];
  running: Ticket[];
  /** 全量工单，按 createdAt 新→旧 */
  tickets: Ticket[];
  recentReplies: string[];
  subscriptions: { threadId: ThreadId; ticketId: TicketId }[];
};

export type RouterDecideInput = {
  event: SuperAgentEvent;
  tickets: readonly Ticket[];
  mandates: readonly Mandate[];
  replies: readonly string[];
};

export type WorkerRunInput = {
  ticket: Ticket;
  mandate: Mandate;
  /** 直达该 Worker 的后续事件（含订阅） */
  mailbox: readonly SuperAgentEvent[];
};

export type CreateSuperAgentInput = {
  id?: string;
  persistDir?: string;
  /** 默认授权；spawn 未指定 mandateId 时使用 */
  defaultMandate?: Omit<Mandate, "id" | "createdAt"> & { id?: MandateId };
  /** running 超过该毫秒未完成 → failed（Watchdog）；默认关闭 */
  ticketTimeoutMs?: number;
  /** 启动时若 persistDir 已有快照则恢复 */
  restore?: boolean;
  routerDecide: (input: RouterDecideInput) => Promise<RouterAction>;
  workerRun: (input: WorkerRunInput) => Promise<WorkerReport>;
};

export class SuperAgent {
  readonly id: string;
  private _status: SuperAgentStatus = "idle";
  private _activeTicketId?: TicketId;
  private readonly _createdAt: string;
  private readonly _persistDir?: string;
  private readonly _ticketTimeoutMs?: number;
  private readonly _routerDecide: CreateSuperAgentInput["routerDecide"];
  private readonly _workerRun: CreateSuperAgentInput["workerRun"];
  private readonly _mandates: Mandate[] = [];
  private readonly _tickets: Ticket[] = [];
  private readonly _inbox: SuperAgentEvent[] = [];
  private readonly _mailboxes = new Map<TicketId, SuperAgentEvent[]>();
  /** threadId → ticketId */
  private readonly _subscriptions = new Map<ThreadId, TicketId>();
  private readonly _replies: string[] = [];
  private readonly _log: { at: string; type: string; detail: unknown }[] = [];

  constructor(input: CreateSuperAgentInput) {
    this.id = input.id ?? randomUUID();
    this._createdAt = new Date().toISOString();
    this._routerDecide = input.routerDecide;
    this._workerRun = input.workerRun;
    if (input.ticketTimeoutMs !== undefined) this._ticketTimeoutMs = input.ticketTimeoutMs;
    if (input.persistDir !== undefined) {
      this._persistDir = input.persistDir;
      mkdirSync(this._persistDir, { recursive: true });
    }
    if (input.restore && this._persistDir) {
      this.restoreFromDisk();
    }
    const dm = input.defaultMandate;
    if (dm && this._mandates.length === 0) {
      this.addMandate({
        id: dm.id ?? randomUUID(),
        scope: dm.scope,
        policyVersion: dm.policyVersion,
        ...(dm.budget !== undefined ? { budget: dm.budget } : {}),
      });
    }
    this.writeSnapshots();
  }

  get meta(): SuperAgentMeta {
    const meta: SuperAgentMeta = {
      id: this.id,
      status: this._status,
      createdAt: this._createdAt,
    };
    if (this._activeTicketId !== undefined) meta.activeTicketId = this._activeTicketId;
    return meta;
  }

  tickets(): readonly Ticket[] {
    return this._tickets;
  }

  mandates(): readonly Mandate[] {
    return this._mandates;
  }

  replies(): readonly string[] {
    return this._replies;
  }

  log(): readonly { at: string; type: string; detail: unknown }[] {
    return this._log;
  }

  /** 人审 / 运维面板只读视图 */
  reviewPanel(): ReviewPanelSnapshot {
    const tickets = [...this._tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      agentId: this.id,
      status: this._status,
      needsHuman: this._tickets.filter((t) => t.status === "needs_human"),
      running: this._tickets.filter((t) => t.status === "running"),
      tickets,
      recentReplies: this._replies.slice(-10),
      subscriptions: [...this._subscriptions.entries()].map(([threadId, ticketId]) => ({ threadId, ticketId })),
    };
  }

  addMandate(partial: Omit<Mandate, "createdAt"> & { createdAt?: string }): Mandate {
    const m: Mandate = {
      id: partial.id,
      scope: partial.scope,
      policyVersion: partial.policyVersion,
      createdAt: partial.createdAt ?? new Date().toISOString(),
      ...(partial.budget !== undefined ? { budget: partial.budget } : {}),
    };
    this._mandates.push(m);
    this.writeSnapshots();
    return m;
  }

  ingest(event: SuperAgentEvent): void {
    if (event.kind === "source_event") {
      const ticketId = this._subscriptions.get(event.threadId);
      if (ticketId) {
        const ticket = this._tickets.find((t) => t.id === ticketId);
        // 仅 running 工单收订阅直达；已结束的订阅丢掉，避免消息被吞
        if (ticket?.status === "running") {
          const box = this._mailboxes.get(ticketId) ?? [];
          box.push(event);
          this._mailboxes.set(ticketId, box);
          this.record("subscribe_deliver", { ticketId, threadId: event.threadId });
          if (this._status === "idle") {
            this._activeTicketId = ticketId;
            this._status = "worker_running";
            this.writeSnapshots();
          }
          this.persistEvent(event);
          return;
        }
        this.clearSubscription(event.threadId);
      }
    }
    this._inbox.push(event);
    this.persistEvent(event);
    this.record("ingest", event);
    // ask_human / worker needs_human park here; the next user/source event is the answer — resume.
    if (this._status === "idle" || this._status === "needs_human") {
      this._status = "router";
      this.writeSnapshots();
    }
  }

  private clearSubscription(threadId: ThreadId): void {
    const ticketId = this._subscriptions.get(threadId);
    if (!ticketId) return;
    this._subscriptions.delete(threadId);
    this.record("unsubscribe", { threadId, ticketId });
  }

  private clearSubscriptionsForTicket(ticketId: TicketId): void {
    for (const [threadId, id] of [...this._subscriptions.entries()]) {
      if (id === ticketId) this._subscriptions.delete(threadId);
    }
  }

  /**
   * Watchdog：把超时仍 running 的 Ticket 标 failed。
   * @returns 本次标记失败的 ticket id 列表
   */
  watch(nowMs = Date.now()): TicketId[] {
    const limit = this._ticketTimeoutMs;
    if (limit === undefined || limit <= 0) return [];
    const failed: TicketId[] = [];
    for (const ticket of this._tickets) {
      if (ticket.status !== "running" || !ticket.startedAt) continue;
      const started = Date.parse(ticket.startedAt);
      if (Number.isNaN(started) || nowMs - started < limit) continue;
      ticket.status = "failed";
      ticket.failReason = `watchdog timeout after ${limit}ms`;
      this.clearSubscriptionsForTicket(ticket.id);
      failed.push(ticket.id);
      this.record("watchdog", { ticketId: ticket.id, failReason: ticket.failReason });
      if (this._activeTicketId === ticket.id) {
        delete this._activeTicketId;
        this._inbox.unshift({
          kind: "worker_report",
          ticketId: ticket.id,
          text: ticket.failReason,
          done: true,
        });
        this._status = "router";
      }
    }
    if (failed.length) this.writeSnapshots();
    return failed;
  }

  /**
   * 推进一轮：先 Watchdog，再跑 active Worker，否则从 inbox 取事件给 Router。
   */
  async step(): Promise<{ phase: "router" | "worker" | "watchdog"; detail: unknown } | null> {
    const timedOut = this.watch();
    if (timedOut.length > 0 && this._status === "router") {
      return { phase: "watchdog", detail: { timedOut } };
    }

    if (this._status === "needs_human") return null;

    if (this._status === "worker_running" && this._activeTicketId) {
      return this.runWorkerStep(this._activeTicketId);
    }

    const event = this._inbox.shift();
    if (!event) {
      this._status = "idle";
      this.writeSnapshots();
      return null;
    }
    return this.runRouterStep(event);
  }

  private async runRouterStep(event: SuperAgentEvent): Promise<{ phase: "router"; detail: unknown }> {
    this._status = "router";
    this.writeSnapshots();
    const action = await this._routerDecide({
      event,
      tickets: this._tickets,
      mandates: this._mandates,
      replies: this._replies,
    });
    this.record("router", { event, action });

    if (action.type === "reply") {
      this._replies.push(action.text);
      this.persistLine("replies.jsonl", { text: action.text, at: new Date().toISOString() });
      this._status = this._inbox.length > 0 ? "router" : "idle";
      this.writeSnapshots();
      return { phase: "router", detail: action };
    }

    if (action.type === "ask_human") {
      this._replies.push(`[needs_human] ${action.text}`);
      this._status = "needs_human";
      this.writeSnapshots();
      return { phase: "router", detail: action };
    }

    const mandate = this.resolveMandate(action.mandateId);
    const now = new Date().toISOString();
    const ticket: Ticket = {
      id: randomUUID(),
      mandateId: mandate.id,
      goal: action.goal,
      status: "running",
      workerId: randomUUID(),
      createdAt: now,
      startedAt: now,
    };
    if (action.threadId !== undefined) {
      ticket.threadId = action.threadId;
      this._subscriptions.set(action.threadId, ticket.id);
      this.record("subscribe", { threadId: action.threadId, ticketId: ticket.id });
    }
    this._tickets.push(ticket);
    this._mailboxes.set(ticket.id, []);
    this._activeTicketId = ticket.id;
    this._status = "worker_running";
    this.writeSnapshots();
    return { phase: "router", detail: { action, ticketId: ticket.id } };
  }

  private async runWorkerStep(ticketId: TicketId): Promise<{ phase: "worker"; detail: unknown }> {
    const ticket = this._tickets.find((t) => t.id === ticketId);
    if (!ticket) throw new Error(`未知 ticket：${ticketId}`);
    const mandate = this._mandates.find((m) => m.id === ticket.mandateId);
    if (!mandate) throw new Error(`未知 mandate：${ticket.mandateId}`);

    const mailbox = this._mailboxes.get(ticketId) ?? [];
    this._mailboxes.set(ticketId, []);

    let report: WorkerReport;
    try {
      report = await this._workerRun({ ticket, mandate, mailbox });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      ticket.status = "failed";
      ticket.failReason = reason;
      ticket.lastReport = reason;
      this.clearSubscriptionsForTicket(ticketId);
      delete this._activeTicketId;
      this._inbox.unshift({
        kind: "worker_report",
        ticketId,
        text: `worker failed: ${reason}`,
        done: true,
      });
      this._status = "router";
      this.record("worker_error", { ticketId, reason });
      this.writeSnapshots();
      return { phase: "worker", detail: { failed: true, reason } };
    }

    this.record("worker", { ticketId, report, mailboxSize: mailbox.length });
    ticket.lastReport = report.text;

    if (report.needsHuman) {
      ticket.status = "needs_human";
      this.clearSubscriptionsForTicket(ticketId);
      delete this._activeTicketId;
      this._status = "needs_human";
      this._replies.push(`[needs_human] ${report.text}`);
      this.writeSnapshots();
      return { phase: "worker", detail: report };
    }
    if (report.done) {
      ticket.status = "done";
      this.clearSubscriptionsForTicket(ticketId);
      delete this._activeTicketId;
      this._inbox.unshift({
        kind: "worker_report",
        ticketId,
        text: report.text,
        done: true,
      });
      this._status = "router";
      this.writeSnapshots();
      return { phase: "worker", detail: report };
    }

    ticket.status = "running";
    this._status = "worker_running";
    this.writeSnapshots();
    return { phase: "worker", detail: report };
  }

  private resolveMandate(mandateId?: MandateId): Mandate {
    if (mandateId) {
      const found = this._mandates.find((m) => m.id === mandateId);
      if (!found) throw new Error(`未知 mandate：${mandateId}`);
      return found;
    }
    const first = this._mandates[0];
    if (first) return first;
    return this.addMandate({
      id: randomUUID(),
      scope: "default demo mandate",
      policyVersion: "s1",
    });
  }

  private record(type: string, detail: unknown): void {
    this._log.push({ at: new Date().toISOString(), type, detail });
  }

  private persistEvent(event: SuperAgentEvent): void {
    this.persistLine("events.jsonl", event);
  }

  private persistLine(file: string, row: unknown): void {
    if (!this._persistDir) return;
    appendFileSync(path.join(this._persistDir, file), `${JSON.stringify(row)}\n`);
  }

  private writeSnapshots(): void {
    if (!this._persistDir) return;
    writeFileSync(path.join(this._persistDir, "meta.json"), `${JSON.stringify(this.meta, null, 2)}\n`);
    writeFileSync(path.join(this._persistDir, "mandates.json"), `${JSON.stringify(this._mandates, null, 2)}\n`);
    writeFileSync(path.join(this._persistDir, "tickets.json"), `${JSON.stringify(this._tickets, null, 2)}\n`);
    writeFileSync(
      path.join(this._persistDir, "subscriptions.json"),
      `${JSON.stringify(Object.fromEntries(this._subscriptions), null, 2)}\n`,
    );
    writeFileSync(path.join(this._persistDir, "replies.json"), `${JSON.stringify(this._replies, null, 2)}\n`);
    writeFileSync(path.join(this._persistDir, "panel.json"), `${JSON.stringify(this.reviewPanel(), null, 2)}\n`);
  }

  private restoreFromDisk(): void {
    if (!this._persistDir) return;
    const mandatesPath = path.join(this._persistDir, "mandates.json");
    const ticketsPath = path.join(this._persistDir, "tickets.json");
    const subsPath = path.join(this._persistDir, "subscriptions.json");
    const repliesPath = path.join(this._persistDir, "replies.json");
    const metaPath = path.join(this._persistDir, "meta.json");
    if (existsSync(mandatesPath)) {
      const rows = JSON.parse(readFileSync(mandatesPath, "utf8")) as Mandate[];
      this._mandates.push(...rows);
    }
    if (existsSync(ticketsPath)) {
      const rows = JSON.parse(readFileSync(ticketsPath, "utf8")) as Ticket[];
      this._tickets.push(...rows);
    }
    if (existsSync(subsPath)) {
      const obj = JSON.parse(readFileSync(subsPath, "utf8")) as Record<string, string>;
      for (const [threadId, ticketId] of Object.entries(obj)) {
        this._subscriptions.set(threadId, ticketId);
        if (!this._mailboxes.has(ticketId)) this._mailboxes.set(ticketId, []);
      }
    }
    if (existsSync(repliesPath)) {
      const rows = JSON.parse(readFileSync(repliesPath, "utf8")) as string[];
      this._replies.push(...rows);
    }
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as SuperAgentMeta;
      this._status = meta.status;
      if (meta.activeTicketId) this._activeTicketId = meta.activeTicketId;
    }
  }
}

export function createSuperAgent(input: CreateSuperAgentInput): SuperAgent {
  return new SuperAgent(input);
}

/** 工单状态子序列是否按序出现（eval）。 */
export function matchesTicketStatusSubsequence(
  tickets: readonly Ticket[],
  expected: { goalIncludes?: string; status: TicketStatus }[],
): boolean {
  let i = 0;
  for (const t of tickets) {
    const want = expected[i];
    if (!want) return true;
    const goalOk = want.goalIncludes === undefined || t.goal.includes(want.goalIncludes);
    if (goalOk && t.status === want.status) i += 1;
  }
  return i === expected.length;
}
