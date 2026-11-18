/**
 * Super-agent 的 Router/Worker 接到真 Session.run（仍不改 DefaultLoop）。
 */
import type { Session, SessionService } from "./types.js";
import type {
  RouterAction,
  RouterDecideInput,
  WorkerReport,
  WorkerRunInput,
} from "./super-agent.js";

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed);
  const raw = (fence ? fence[1]! : trimmed).trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`不是 JSON：${trimmed.slice(0, 160)}`);
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (typeof parsed !== "object" || parsed === null) throw new Error("JSON 必须是对象");
  return parsed as Record<string, unknown>;
}

export function buildRouterPrompt(input: RouterDecideInput): string {
  const eventLine = (() => {
    const e = input.event;
    if (e.kind === "user_message") return `[user] ${e.text}`;
    if (e.kind === "source_event") return `[${e.source}/${e.threadId}] ${e.text}`;
    return `[worker_report ticket=${e.ticketId} done=${e.done === true}] ${e.text}`;
  })();
  const tickets =
    input.tickets.length === 0
      ? "(none)"
      : input.tickets.map((t) => `- ${t.id.slice(0, 8)} ${t.status}: ${t.goal}`).join("\n");
  return [
    "You are the Super-agent Router. You do not edit files or run shell.",
    "Decide the next action as a single JSON object (no markdown fence):",
    '  { "type":"reply", "text":"..." }',
    '  { "type":"spawn_ticket", "goal":"...", "threadId":"optional" }',
    '  { "type":"ask_human", "text":"..." }',
    "",
    "Event:",
    eventLine,
    "",
    "Tickets:",
    tickets,
    "",
    "Rules: spawn_ticket when the user asks for implementation work;",
    "reply when a worker_report is done or when a short answer suffices.",
  ].join("\n");
}

export function parseRouterAction(text: string): RouterAction {
  const row = parseJsonObject(text);
  if (row.type === "reply") {
    if (typeof row.text !== "string") throw new Error("reply.text 必须是字符串");
    return { type: "reply", text: row.text };
  }
  if (row.type === "ask_human") {
    if (typeof row.text !== "string") throw new Error("ask_human.text 必须是字符串");
    return { type: "ask_human", text: row.text };
  }
  if (row.type === "spawn_ticket") {
    if (typeof row.goal !== "string") throw new Error("spawn_ticket.goal 必须是字符串");
    const out: RouterAction = { type: "spawn_ticket", goal: row.goal };
    if (typeof row.mandateId === "string") out.mandateId = row.mandateId;
    if (typeof row.threadId === "string") out.threadId = row.threadId;
    return out;
  }
  throw new Error(`RouterAction.type 非法：${String(row.type)}`);
}

export function buildWorkerPrompt(input: WorkerRunInput): string {
  const mail =
    input.mailbox.length === 0
      ? "(empty)"
      : input.mailbox
          .map((e) => {
            if (e.kind === "source_event") return `[${e.source}] ${e.text}`;
            return JSON.stringify(e);
          })
          .join("\n");
  return [
    "You are a Super-agent Worker. Complete the ticket goal.",
    `Mandate scope: ${input.mandate.scope}`,
    `Goal: ${input.ticket.goal}`,
    "",
    "Mailbox (follow-ups):",
    mail,
    "",
    "Reply with a single JSON object only:",
    '  { "text":"...", "done": true }',
    '  { "text":"...", "done": false }',
    '  { "text":"...", "needsHuman": true }',
  ].join("\n");
}

export function parseWorkerReport(text: string): WorkerReport {
  const row = parseJsonObject(text);
  if (typeof row.text !== "string") throw new Error("WorkerReport.text 必须是字符串");
  const out: WorkerReport = { text: row.text };
  if (typeof row.done === "boolean") out.done = row.done;
  if (typeof row.needsHuman === "boolean") out.needsHuman = row.needsHuman;
  return out;
}

/**
 * Router Runtime 建议 deny 的写/执行工具（挂 permissionsPlugin({ deny: ... })）。
 * Worker Runtime 不要用这份列表。
 */
export const SUPER_AGENT_ROUTER_DENIED_TOOLS = [
  "write_file",
  "edit_file",
  "execute_command",
] as const;

export type SessionSuperAgentRunnersOptions = {
  sessions: SessionService;
  freshSession?: boolean;
};

/** 返回可注入 createSuperAgent 的 routerDecide / workerRun。 */
export function createSessionSuperAgentRunners(options: SessionSuperAgentRunnersOptions): {
  routerDecide: (input: RouterDecideInput) => Promise<RouterAction>;
  workerRun: (input: WorkerRunInput) => Promise<WorkerReport>;
} {
  const fresh = options.freshSession !== false;
  let routerSession: Session | undefined;
  return {
    async routerDecide(input) {
      const session = fresh
        ? await options.sessions.create()
        : (routerSession ??= await options.sessions.create());
      const result = await session.run(buildRouterPrompt(input));
      return parseRouterAction(result.text);
    },
    async workerRun(input) {
      const session = await options.sessions.create();
      const result = await session.run(buildWorkerPrompt(input));
      return parseWorkerReport(result.text);
    },
  };
}
