/**
 * 把 AgentRoom 的 TurnRunner 接到真 Session.run（仍不改 DefaultLoop）。
 * 成员 persona + 可见 transcript 打进 prompt；模型需回 JSON TurnOutput。
 */
import type { Session, SessionService } from "./types.js";
import type { RoomMember, RoomMessage, TurnOutput, TurnRunner } from "./room.js";

const KINDS = new Set(["chat", "delegate", "result", "status", "error"]);

export function formatVisibleTranscript(visible: readonly RoomMessage[]): string {
  if (visible.length === 0) return "(empty)";
  return visible
    .map((m) => {
      const who = m.from;
      const done = m.done ? " done=true" : "";
      const mention = m.mention?.length ? ` mention=${m.mention.join(",")}` : "";
      return `[${who}/${m.kind}${mention}${done}] ${m.text}`;
    })
    .join("\n");
}

export function buildRoomTurnPrompt(member: RoomMember, visible: readonly RoomMessage[]): string {
  return [
    `You are room member "${member.id}" (${member.displayName}).`,
    `Persona: ${member.persona}`,
    "",
    "Visible transcript:",
    formatVisibleTranscript(visible),
    "",
    "Reply with a single JSON object only (no markdown fence), fields:",
    '  kind: "chat" | "delegate" | "result" | "status" | "error"',
    "  text: string",
    '  mention?: string[]  (required for kind=delegate, member ids)',
    "  done?: boolean      (true when kind=status and the room goal is finished)",
    "",
    "Rules: do not invent tool facts; if data is missing, say so in text.",
  ].join("\n");
}

/** 从助手文本里抽出 TurnOutput；失败抛错。 */
export function parseTurnOutput(text: string): TurnOutput {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed);
  const raw = (fence ? fence[1]! : trimmed).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(`TurnOutput 不是 JSON：${trimmed.slice(0, 160)}`);
    parsed = JSON.parse(raw.slice(start, end + 1));
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("TurnOutput 必须是对象");
  const row = parsed as Record<string, unknown>;
  if (typeof row.kind !== "string" || !KINDS.has(row.kind)) {
    throw new Error(`TurnOutput.kind 非法：${String(row.kind)}`);
  }
  if (typeof row.text !== "string") throw new Error("TurnOutput.text 必须是字符串");
  const out: TurnOutput = {
    kind: row.kind as TurnOutput["kind"],
    text: row.text,
  };
  if (Array.isArray(row.mention)) {
    const mention = row.mention.filter((x): x is string => typeof x === "string");
    if (mention.length > 0) out.mention = mention;
  }
  if (typeof row.done === "boolean") out.done = row.done;
  if (out.kind === "delegate" && (!out.mention || out.mention.length === 0)) {
    throw new Error("delegate 必须带 mention");
  }
  return out;
}

export type SessionTurnRunnerOptions = {
  /** 默认从 runtime 取 SESSION；测试可注入 */
  sessions: SessionService;
  /** 每回合新建 session（默认 true） */
  freshSession?: boolean;
};

/**
 * 真 Session 驱动的 TurnRunner。
 * 注意：成员 allowlist / 禁止 run_subagent 由外层 Runtime 的 tools+permissions 决定；本函数不挂子 Agent。
 */
export function createSessionTurnRunner(options: SessionTurnRunnerOptions): TurnRunner {
  const fresh = options.freshSession !== false;
  let reused: Session | undefined;
  return async ({ member, visible }) => {
    const session = fresh ? await options.sessions.create() : (reused ??= await options.sessions.create());
    const result = await session.run(buildRoomTurnPrompt(member, visible));
    return parseTurnOutput(result.text);
  };
}
