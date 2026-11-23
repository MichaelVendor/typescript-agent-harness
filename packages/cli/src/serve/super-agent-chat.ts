/**
 * Embed Super-agent in `tah serve`: web + optional IM (Telegram/…) in one engine.
 * `reload()` rebuilds IM adapters from tah.channels.json + settings (no serve restart).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createDingTalkAdapter,
  createFeishuAdapter,
  createMockChannel,
  createSlackAdapter,
  createTelegramAdapter,
  type ChannelAdapter,
  type InboundMessage,
  type MockChannel,
  type ReplyHandle,
} from "@typescript-agent-harness/channels";
import { loadChannelHostConfig } from "../channel-host/config.js";
import { createChannelHostEngine, type ChannelHostEngine } from "../channel-host/runtime.js";
import type { ChatHost, HostEvent } from "../host.js";

export type SuperAgentChat = {
  persistDir: string;
  wrap(host: ChatHost): ChatHost;
  /** Re-read channel config/secrets and restart IM adapters (web chat stays up). */
  reload(): Promise<void>;
  stop(): Promise<void>;
};

export type CreateSuperAgentChatInput = {
  cwd: string;
  persistDir: string;
  mockLlm: boolean;
  homeDir?: string;
  /** Tests: extra adapters (e.g. mock named "telegram"). */
  extraAdapters?: ChannelAdapter[];
  /** Tests: do not load tah.channels.json IM. */
  skipConfigChannels?: boolean;
};

function buildConfigAdapters(cwd: string, homeDir?: string): ChannelAdapter[] {
  const cfg = loadChannelHostConfig(cwd, homeDir ? { homeDir } : undefined);
  const adapters: ChannelAdapter[] = [];
  if (cfg.telegram.enabled) {
    if (!cfg.telegram.token) throw new Error("Telegram is enabled but bot token is missing");
    adapters.push(createTelegramAdapter({ token: cfg.telegram.token }));
  }
  if (cfg.slack.enabled) {
    if (!cfg.slack.botToken || !cfg.slack.signingSecret) {
      throw new Error("Slack is enabled but bot token or signing secret is missing");
    }
    adapters.push(
      createSlackAdapter({ botToken: cfg.slack.botToken, signingSecret: cfg.slack.signingSecret }),
    );
  }
  if (cfg.feishu.enabled) {
    if (!cfg.feishu.appId || !cfg.feishu.appSecret || !cfg.feishu.verificationToken) {
      throw new Error("Feishu is enabled but app credentials are incomplete");
    }
    adapters.push(
      createFeishuAdapter({
        appId: cfg.feishu.appId,
        appSecret: cfg.feishu.appSecret,
        verificationToken: cfg.feishu.verificationToken,
      }),
    );
  }
  if (cfg.dingtalk.enabled) {
    if (!cfg.dingtalk.verificationToken) {
      throw new Error("DingTalk is enabled but verification token is missing");
    }
    adapters.push(
      createDingTalkAdapter({
        verificationToken: cfg.dingtalk.verificationToken,
        ...(cfg.dingtalk.appKey ? { appKey: cfg.dingtalk.appKey } : {}),
        ...(cfg.dingtalk.appSecret ? { appSecret: cfg.dingtalk.appSecret } : {}),
      }),
    );
  }
  return adapters;
}

function configuredTelegramChatId(cwd: string): number | undefined {
  const filePath = path.join(cwd, "tah.channels.json");
  if (!existsSync(filePath)) return undefined;
  try {
    const file = JSON.parse(readFileSync(filePath, "utf8")) as {
      channels?: { telegram?: { mirrorChatId?: number | string } };
    };
    const raw = file.channels?.telegram?.mirrorChatId;
    if (raw === undefined || raw === "") return undefined;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

/** Remember the TG peer so web ↔ Telegram survives reload / restart. */
function persistTelegramMirrorChatId(cwd: string, chatId: number): void {
  const filePath = path.join(cwd, "tah.channels.json");
  let file: {
    persistDir?: string;
    port?: number;
    channels?: {
      telegram?: { enabled?: boolean; mirrorChatId?: number | string | null };
      slack?: { enabled?: boolean };
      feishu?: { enabled?: boolean };
    };
  } = {};
  if (existsSync(filePath)) {
    try {
      file = JSON.parse(readFileSync(filePath, "utf8")) as typeof file;
    } catch {
      file = {};
    }
  }
  const prev = configuredTelegramChatId(cwd);
  if (prev === chatId) return;
  const channels = { ...(file.channels ?? {}) };
  channels.telegram = { ...(channels.telegram ?? {}), enabled: channels.telegram?.enabled !== false, mirrorChatId: chatId };
  writeFileSync(
    filePath,
    `${JSON.stringify({ persistDir: file.persistDir ?? ".tah/super-agent", ...(file.port !== undefined ? { port: file.port } : {}), channels }, null, 2)}\n`,
  );
  console.log(`[tah] telegram mirrorChatId → ${chatId} (saved for web ↔ TG)`);
}

export async function createSuperAgentChat(input: CreateSuperAgentChatInput): Promise<SuperAgentChat> {
  const persistDir = path.resolve(input.cwd, input.persistDir);
  const extras = input.extraAdapters ?? [];

  let web: MockChannel = createMockChannel({ name: "web" });
  let adapterByName = new Map<string, ChannelAdapter>();
  let engine: ChannelHostEngine;
  let lastIm: ReplyHandle | undefined;
  let emitLive: ((event: HostEvent) => void) | undefined;
  let seq = 0;
  let cancelled = false;
  let uiLock: Promise<void> = Promise.resolve();

  const hooks = {
    onInbound(msg: InboundMessage) {
      if (msg.source === "web" || msg.source === "mock") return;
      lastIm = msg.replyTo;
      if (msg.source === "telegram" && msg.replyTo.kind === "telegram") {
        const chatId = (msg.replyTo as { chatId?: unknown }).chatId;
        if (typeof chatId === "number") persistTelegramMirrorChatId(input.cwd, chatId);
      }
      const emit = emitLive;
      if (!emit) return;
      uiLock = uiLock
        .then(async () => {
          emit({ type: "user", text: msg.text, channel: msg.source });
        })
        .catch(() => {});
    },
    async onOutbound(replyTo: ReplyHandle, text: string) {
      if (replyTo.kind === "web" || replyTo.kind === "mock") return;
      const emit = emitLive;
      if (!emit) return;
      uiLock = uiLock
        .then(async () => {
          emit({ type: "text", delta: text });
          emit({
            type: "turn.end",
            state: "idle",
            finishReason: "stop",
            rounds: 1,
            model: "super-agent",
          });
        })
        .catch(() => {});
      await uiLock;
    },
  };

  async function startEngine(): Promise<ChannelAdapter[]> {
    const imAdapters = input.skipConfigChannels ? [] : buildConfigAdapters(input.cwd, input.homeDir);
    web = createMockChannel({ name: "web" });
    const adapters: ChannelAdapter[] = [web, ...imAdapters, ...extras];
    adapterByName = new Map(adapters.map((a) => [a.name, a]));

    const chatId = configuredTelegramChatId(input.cwd);
    if (chatId !== undefined) lastIm = { kind: "telegram", chatId };
    else if (lastIm) {
      const name = lastIm.kind === "mock" ? "mock" : lastIm.kind;
      if (!adapterByName.has(name)) lastIm = undefined;
    }

    engine = await createChannelHostEngine({
      persistDir,
      adapters,
      mockLlm: input.mockLlm,
      ...(input.homeDir ? { homeDir: input.homeDir } : {}),
      onInbound: hooks.onInbound,
      onOutbound: hooks.onOutbound,
    });
    return imAdapters;
  }

  function logBridge(imAdapters: ChannelAdapter[]) {
    if (imAdapters.length > 0 || extras.length > 0) {
      console.log(
        `[tah] super-agent IM bridge: ${[...imAdapters, ...extras].map((a) => a.name).join(", ")}` +
          (lastIm ? " (mirror peer ready)" : " — message the bot once, or set telegram.mirrorChatId"),
      );
    } else {
      console.log("[tah] super-agent IM bridge: (none)");
    }
  }

  logBridge(await startEngine());

  let warnedNoPeer = false;
  async function mirrorToIm(prefix: string, text: string): Promise<void> {
    if (!lastIm) {
      if (!warnedNoPeer && adapterByName.has("telegram")) {
        warnedNoPeer = true;
        emitLive?.({
          type: "notice",
          text: "[tah] Telegram is on, but no chat is linked yet — send any message to the bot in Telegram once, then web ↔ TG will mirror.",
        });
      }
      return;
    }
    const name = lastIm.kind === "mock" ? "mock" : lastIm.kind;
    const adapter = adapterByName.get(name);
    if (!adapter) return;
    try {
      await adapter.send(lastIm, `${prefix}${text}`);
    } catch (err) {
      console.error("[super-agent] mirror to IM failed:", err instanceof Error ? err.message : err);
    }
  }

  function wrap(host: ChatHost): ChatHost {
    const listeners = new Set<(event: HostEvent) => void>();
    const emit = (event: HostEvent) => {
      for (const listener of listeners) listener(event);
    };
    emitLive = emit;

    const runTurn = async (text: string): Promise<void> => {
      const display = text.trim();
      if (!display) throw new Error("message is empty");
      cancelled = false;
      await uiLock;
      emit({ type: "user", text: display });
      await mirrorToIm("🖥️ ", display);
      const before = web.sent.length;
      web.push({
        source: "web",
        threadId: `web:session/${host.sessionId}`,
        text: display,
        isNewThread: true,
        replyTo: { kind: "web", id: String(++seq) },
      });
      // Real LLM can take well over 5s; park until reply, cancel, or ~2min.
      for (let i = 0; i < 4800; i += 1) {
        if (cancelled) {
          emit({ type: "turn.error", cancelled: true, message: "cancelled" });
          return;
        }
        if (web.sent.length > before) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const outbound = web.sent
        .slice(before)
        .map((s) => s.text)
        .join("\n");
      if (!outbound) {
        emit({ type: "turn.error", cancelled: false, message: "super-agent produced no reply" });
        return;
      }
      emit({ type: "text", delta: outbound });
      await mirrorToIm("", outbound);
      emit({
        type: "turn.end",
        state: "idle",
        finishReason: "stop",
        rounds: 1,
        model: "super-agent",
      });
    };

    return {
      get sessionId() {
        return host.sessionId;
      },
      get approve() {
        return host.approve;
      },
      get permissionMode() {
        return host.permissionMode;
      },
      setPermissionMode(mode) {
        host.setPermissionMode(mode);
      },
      get browser() {
        return host.browser;
      },
      get skills() {
        return host.skills;
      },
      get slashPrompts() {
        return host.slashPrompts;
      },
      on(listener) {
        const off = host.on(listener);
        listeners.add(listener);
        return () => {
          off();
          listeners.delete(listener);
        };
      },
      open: () => host.open(),
      snapshot: () => host.snapshot(),
      saveAttachment: (file) => host.saveAttachment(file),
      async send(text, attachmentIds = []) {
        if (attachmentIds.length > 0) {
          throw new Error("super-agent web chat does not support attachments yet");
        }
        return runTurn(text);
      },
      sendQueued: (id) => host.sendQueued(id),
      removeQueued: (id) => host.removeQueued(id),
      continueTurn: () => host.continueTurn(),
      compact: () => host.compact(),
      cancel() {
        cancelled = true;
        host.cancel();
      },
      answer: (id, answer) => host.answer(id, answer),
      answerQuestion: (id, answers) => host.answerQuestion(id, answers),
      skipQuestion: (id) => host.skipQuestion(id),
      reset: () => host.reset(),
      resume: (ref) => host.resume(ref),
      fork: (turns) => host.fork(turns),
      listSessions: () => host.listSessions(),
      renameSession: (id, title) => host.renameSession(id, title),
      setSessionFlag: (id, flag, on) => host.setSessionFlag(id, flag, on),
      reload: () => host.reload(),
      close: () => host.close(),
    };
  }

  return {
    persistDir,
    wrap,
    async reload() {
      await engine.stop();
      logBridge(await startEngine());
    },
    stop: () => engine.stop(),
  };
}
