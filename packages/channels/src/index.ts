export {
  toSuperAgentEvent,
  type ChannelAdapter,
  type ChannelHandlers,
  type ChannelSource,
  type ChannelSuperAgentEvent,
  type InboundMessage,
  type ReplyHandle,
} from "./types.js";
export { createMockChannel, type MockChannel } from "./mock.js";
export {
  createTelegramAdapter,
  parseTelegramUpdates,
  shouldHandleTelegramMessage,
  telegramThreadId,
  type TelegramAdapterOptions,
  type TelegramReplyHandle,
} from "./telegram.js";
export {
  createSlackAdapter,
  ingestSlackPayload,
  slackThreadId,
  verifySlackSignature,
  type SlackAdapterOptions,
  type SlackReplyHandle,
} from "./slack.js";
export {
  createFeishuAdapter,
  feishuThreadId,
  ingestFeishuPayload,
  type FeishuAdapterOptions,
  type FeishuReplyHandle,
} from "./feishu.js";
export {
  createDingTalkAdapter,
  dingtalkThreadId,
  ingestDingTalkPayload,
  type DingTalkAdapterOptions,
  type DingTalkReplyHandle,
} from "./dingtalk.js";
