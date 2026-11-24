import path from "node:path";
import {
  createRoom,
  type AgentRoom,
  type MemberId,
  type RoomMember,
  type RoomMessage,
  type RoomMeta,
  type TurnRunner,
} from "@typescript-agent-harness/agent";
import { loadTeamSettings } from "../team-settings.js";

export type RoomSnapshot = { meta: RoomMeta; messages: readonly RoomMessage[] };

export type RoomHost = {
  getSnapshot(): RoomSnapshot;
  setGoal(text: string): RoomSnapshot;
  postUserMessage(text: string): RoomSnapshot | { queued: true };
  step(): Promise<RoomSnapshot>;
};

function teamMembers(cwd: string): RoomMember[] {
  return loadTeamSettings(cwd).map((m) => ({
    id: m.id as MemberId,
    displayName: m.displayName,
    persona: m.persona,
  }));
}

/** Deterministic stub runner for `--mock` / tests (matches agent room.test flow). */
export function createMockTurnRunner(members: readonly RoomMember[]): TurnRunner {
  const firstNonTl = members.find((m) => m.id !== "tl")?.id;
  return async ({ member, visible, meta }) => {
    const hasUser =
      meta.goal.trim().length > 0 || visible.some((m) => m.from === "user" && m.kind === "chat");
    if (member.id === "tl") {
      if (!hasUser) return { kind: "chat", text: "mock:tl waiting for goal" };
      const hasResult = visible.some((m) => m.kind === "result");
      if (hasResult) {
        return { kind: "status", text: "mock:tl done", done: true };
      }
      if (!firstNonTl) {
        return { kind: "status", text: "mock:tl no delegatee", done: true };
      }
      return {
        kind: "delegate",
        text: "mock:tl delegate",
        mention: [firstNonTl],
      };
    }
    return { kind: "result", text: `mock:${member.id} stub` };
  };
}

function runnerFor(members: RoomMember[], mock: boolean): TurnRunner {
  if (mock) return createMockTurnRunner(members);
  return async () => {
    throw new Error("Room turn runner requires --mock (session runner not wired in serve yet)");
  };
}

function snap(room: AgentRoom): RoomSnapshot {
  return { meta: room.meta, messages: room.transcript() };
}

export function createRoomHost(input: {
  cwd: string;
  mock: boolean;
  /** Default `<cwd>/.tah/room` */
  persistDir?: string;
}): RoomHost {
  const persistDir = input.persistDir ?? path.join(input.cwd, ".tah", "room");
  let room: AgentRoom;

  const open = (goal: string) => {
    const members = teamMembers(input.cwd);
    room = createRoom({
      goal,
      members,
      persistDir,
      turnRunner: runnerFor(members, input.mock),
    });
  };

  open("");

  return {
    getSnapshot: () => snap(room),
    setGoal(text: string) {
      open(text);
      room.post({ from: "user", kind: "chat", text });
      return snap(room);
    },
    postUserMessage(text: string) {
      const out = room.post({ from: "user", kind: "chat", text });
      if ("queued" in out) return { queued: true as const };
      return snap(room);
    },
    async step() {
      await room.step();
      return snap(room);
    },
  };
}