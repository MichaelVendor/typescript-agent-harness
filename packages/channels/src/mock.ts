import type { ChannelAdapter, ChannelHandlers, InboundMessage, ReplyHandle } from "./types.js";

export type MockChannel = ChannelAdapter & {
  /** Inject an inbound message (after start). */
  push(msg: InboundMessage): void;
  /** Outbound messages recorded by send(). */
  readonly sent: readonly { replyTo: ReplyHandle; text: string }[];
};

export function createMockChannel(options?: { name?: string }): MockChannel {
  const name = options?.name ?? "mock";
  const sent: { replyTo: ReplyHandle; text: string }[] = [];
  let handlers: ChannelHandlers | undefined;
  let running = false;

  return {
    name,
    get sent() {
      return sent;
    },
    async start(h) {
      handlers = h;
      running = true;
    },
    async stop() {
      running = false;
      handlers = undefined;
    },
    async send(replyTo, text) {
      sent.push({ replyTo, text });
    },
    push(msg) {
      if (!running || !handlers) throw new Error("mock channel not started");
      handlers.onMessage(msg);
    },
  };
}
