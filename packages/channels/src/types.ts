/** P0 workplace IM sources. */
export type ChannelSource = "telegram" | "slack" | "feishu" | "mock" | "web";

/** Opaque outbound handle; adapters cast by `kind`. */
export type ReplyHandle = {
  kind: string;
  [key: string]: unknown;
};

export type InboundMessage = {
  source: ChannelSource;
  threadId: string;
  text: string;
  /** true → Super-agent `user_message`; false → `source_event` (subscribed follow-up). */
  isNewThread: boolean;
  replyTo: ReplyHandle;
};

export type ChannelHandlers = {
  onMessage(msg: InboundMessage): void;
};

export type ChannelAdapter = {
  readonly name: string;
  start(handlers: ChannelHandlers): Promise<void>;
  stop(): Promise<void>;
  send(replyTo: ReplyHandle, text: string): Promise<void>;
};

/**
 * Structural Super-agent event (no dependency on @agent).
 * Host maps this into `createSuperAgent` ingest.
 */
export type ChannelSuperAgentEvent =
  | { kind: "user_message"; text: string; channel: string }
  | { kind: "source_event"; source: string; threadId: string; text: string };

export function toSuperAgentEvent(msg: InboundMessage): ChannelSuperAgentEvent {
  if (msg.isNewThread) {
    return { kind: "user_message", text: msg.text, channel: msg.source };
  }
  return {
    kind: "source_event",
    source: msg.source,
    threadId: msg.threadId,
    text: msg.text,
  };
}
