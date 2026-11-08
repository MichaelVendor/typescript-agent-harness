/**
 * Agent Room — 旁路群聊编排（不进入 DefaultLoop）。
 * Session/TurnRunner 负责「一个说话者一轮」；Room 负责 transcript、可见性、回合状态。
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type MemberId = "tl" | (string & {});

export type MessageVisibility =
  | { mode: "all" }
  | { mode: "tl_only" }
  | { mode: "to"; ids: MemberId[] };

export type RoomMessageKind = "chat" | "delegate" | "result" | "status" | "error";

export type RoomMessage = {
  id: string;
  at: string;
  roomId: string;
  from: "user" | "system" | MemberId;
  mention?: MemberId[];
  kind: RoomMessageKind;
  text: string;
  visibility?: MessageVisibility;
  /** TL 收口：调度以该字段为准，不解析文案前缀 */
  done?: boolean;
  traceHint?: { tools?: string[]; ok?: boolean };
};

export type RoomStatus = "idle" | "tl_thinking" | "member_running" | "done" | "failed";

export type RoomMember = {
  id: MemberId;
  displayName: string;
  persona: string;
  allowTools?: string[];
  modelHint?: string;
};

export type RoomMeta = {
  roomId: string;
  status: RoomStatus;
  activeMember?: MemberId;
  goal: string;
  members: RoomMember[];
  createdAt: string;
};

export type TurnOutput = {
  kind: RoomMessageKind;
  text: string;
  mention?: MemberId[];
  done?: boolean;
  visibility?: MessageVisibility;
  traceHint?: RoomMessage["traceHint"];
};

export type TurnRunner = (input: {
  member: RoomMember;
  visible: readonly RoomMessage[];
  meta: RoomMeta;
}) => Promise<TurnOutput>;

export type CreateRoomInput = {
  goal: string;
  members: RoomMember[];
  roomId?: string;
  /** 若提供，则每条消息 append 到该目录下 transcript.jsonl，并刷新 meta.json */
  persistDir?: string;
  turnRunner: TurnRunner;
};

type PostInput = Omit<RoomMessage, "id" | "at" | "roomId">;

function visibilityOf(msg: RoomMessage): MessageVisibility {
  return msg.visibility ?? { mode: "all" };
}

/** 某成员本轮可见的消息（含 user/system 按规则过滤）。 */
export function visibleMessagesFor(memberId: MemberId, messages: readonly RoomMessage[]): RoomMessage[] {
  return messages.filter((msg) => {
    const vis = visibilityOf(msg);
    if (vis.mode === "all") return true;
    if (msg.from === memberId) return true;
    if (vis.mode === "to") return vis.ids.includes(memberId);
    if (vis.mode === "tl_only") return memberId === "tl" || msg.from === "user";
    return false;
  });
}

function requireTl(members: RoomMember[]): void {
  if (!members.some((m) => m.id === "tl")) {
    throw new Error('Room members 必须包含 id 为 "tl" 的成员');
  }
}

export class AgentRoom {
  readonly id: string;
  private readonly _members: RoomMember[];
  private _status: RoomStatus = "idle";
  private _activeMember?: MemberId;
  private readonly _goal: string;
  private readonly _createdAt: string;
  private readonly _messages: RoomMessage[] = [];
  private readonly _userQueue: PostInput[] = [];
  private readonly _runner: TurnRunner;
  private readonly _persistDir?: string;

  constructor(input: CreateRoomInput) {
    requireTl(input.members);
    this.id = input.roomId ?? randomUUID();
    this._goal = input.goal;
    this._members = [...input.members];
    this._createdAt = new Date().toISOString();
    this._runner = input.turnRunner;
    if (input.persistDir !== undefined) this._persistDir = input.persistDir;
    if (this._persistDir) {
      mkdirSync(this._persistDir, { recursive: true });
      this.writeMeta();
    }
  }

  get meta(): RoomMeta {
    const meta: RoomMeta = {
      roomId: this.id,
      status: this._status,
      goal: this._goal,
      members: this._members.map((m) => ({ ...m })),
      createdAt: this._createdAt,
    };
    if (this._activeMember !== undefined) meta.activeMember = this._activeMember;
    return meta;
  }

  transcript(): readonly RoomMessage[] {
    return this._messages;
  }

  member(id: MemberId): RoomMember {
    const found = this._members.find((m) => m.id === id);
    if (!found) throw new Error(`未知成员：${id}`);
    return found;
  }

  /**
   * 用户/系统/角色发言。
   * - user 在 idle|tl_thinking：立刻入 transcript，idle→tl_thinking
   * - user 在 member_running：入队，不打断
   * - 其它 from：立刻入 transcript（供测试/脚本直接塞 delegate 等）
   */
  post(msg: PostInput): RoomMessage | { queued: true } {
    if (msg.from === "user") {
      if (this._status === "member_running") {
        this._userQueue.push(msg);
        return { queued: true };
      }
      if (this._status !== "idle" && this._status !== "tl_thinking") {
        throw new Error(`状态 ${this._status} 下不能插入用户消息`);
      }
      const posted = this.append(msg);
      if (this._status === "idle") {
        this._status = "tl_thinking";
        this._activeMember = "tl";
        this.writeMeta();
      }
      return posted;
    }
    return this.append(msg);
  }

  /** 跑指定成员一轮（由 TurnRunner 产出内容，Room 负责落消息与改状态）。 */
  async runTurn(memberId: MemberId): Promise<RoomMessage> {
    if (this._status === "done" || this._status === "failed") {
      throw new Error(`房间已结束（${this._status}），不能再 runTurn`);
    }
    const member = this.member(memberId);
    if (memberId === "tl") {
      this._status = "tl_thinking";
      this._activeMember = "tl";
    } else {
      this._status = "member_running";
      this._activeMember = memberId;
    }
    this.writeMeta();

    const visible = visibleMessagesFor(memberId, this._messages);
    const out = await this._runner({ member, visible, meta: this.meta });
    const post: PostInput = {
      from: memberId,
      kind: out.kind,
      text: out.text,
    };
    if (out.mention !== undefined) post.mention = out.mention;
    if (out.done !== undefined) post.done = out.done;
    if (out.visibility !== undefined) post.visibility = out.visibility;
    if (out.traceHint !== undefined) post.traceHint = out.traceHint;
    const posted = this.append(post);

    this.applyTurnEffects(posted);
    this.drainUserQueue();
    this.writeMeta();
    return posted;
  }

  /**
   * Demo 调度：按状态推进下一说话者。
   * idle 且已有 user 消息时应先被 post 成 tl_thinking。
   */
  async step(): Promise<RoomMessage | null> {
    if (this._status === "done" || this._status === "failed") return null;
    if (this._status === "idle") return null;
    if (this._status === "tl_thinking") return this.runTurn("tl");
    if (this._status === "member_running" && this._activeMember) {
      return this.runTurn(this._activeMember);
    }
    return null;
  }

  private clearActiveMember(): void {
    delete this._activeMember;
  }

  private applyTurnEffects(posted: RoomMessage): void {
    if (posted.kind === "status" && posted.done === true) {
      this._status = "done";
      this.clearActiveMember();
      return;
    }
    if (posted.kind === "delegate") {
      const next = posted.mention?.[0];
      if (!next || next === "tl") {
        this._status = "failed";
        this.clearActiveMember();
        this.append({
          from: "system",
          kind: "error",
          text: "delegate 必须 mention 一个非 tl 成员",
        });
        return;
      }
      this.member(next);
      this._status = "member_running";
      this._activeMember = next;
      return;
    }
    if (posted.kind === "result") {
      this._status = "tl_thinking";
      this._activeMember = "tl";
      return;
    }
    // chat / 其它：保持当前说话者上下文，回到 tl_thinking 若是 tl
    if (posted.from === "tl") {
      this._status = "tl_thinking";
      this._activeMember = "tl";
    }
  }

  private drainUserQueue(): void {
    if (this._status !== "tl_thinking" && this._status !== "idle") return;
    while (this._userQueue.length > 0) {
      const next = this._userQueue.shift();
      if (!next) break;
      this.append(next);
      if (this._status === "idle") {
        this._status = "tl_thinking";
        this._activeMember = "tl";
      }
    }
  }

  private append(msg: PostInput): RoomMessage {
    const full: RoomMessage = {
      ...msg,
      id: randomUUID(),
      at: new Date().toISOString(),
      roomId: this.id,
    };
    this._messages.push(full);
    if (this._persistDir) {
      appendFileSync(path.join(this._persistDir, "transcript.jsonl"), `${JSON.stringify(full)}\n`);
    }
    return full;
  }

  private writeMeta(): void {
    if (!this._persistDir) return;
    writeFileSync(path.join(this._persistDir, "meta.json"), `${JSON.stringify(this.meta, null, 2)}\n`);
  }
}

export function createRoom(input: CreateRoomInput): AgentRoom {
  return new AgentRoom(input);
}

/** transcript 中 kind/from 子序列是否按序出现（用于 eval）。 */
export function matchesMessageSubsequence(
  messages: readonly RoomMessage[],
  expected: { from: RoomMessage["from"]; kind: RoomMessageKind }[],
): boolean {
  let i = 0;
  for (const msg of messages) {
    const want = expected[i];
    if (!want) return true;
    if (msg.from === want.from && msg.kind === want.kind) i += 1;
  }
  return i === expected.length;
}
