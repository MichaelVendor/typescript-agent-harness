import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  createFeishuAdapter,
  createMockChannel,
  createSlackAdapter,
  createTelegramAdapter,
  type ChannelAdapter,
  type MockChannel,
} from "@typescript-agent-harness/channels";
import type { CliFlags } from "../args.js";
import { loadChannelHostConfig } from "./config.js";
import { createChannelHostEngine } from "./runtime.js";

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
}

export type StartChannelHostResult = {
  url: string;
  persistDir: string;
  mock?: MockChannel;
  stop(): Promise<void>;
};

export async function startChannelHost(
  flags: CliFlags,
  opts?: { mockChannel?: boolean },
): Promise<StartChannelHostResult> {
  const mockChannel = opts?.mockChannel === true || flags.mockChannel === true;
  const cfg = loadChannelHostConfig(flags.cwd, { port: flags.port });
  const adapters: ChannelAdapter[] = [];
  let mock: MockChannel | undefined;
  let slack: ReturnType<typeof createSlackAdapter> | undefined;
  let feishu: ReturnType<typeof createFeishuAdapter> | undefined;

  if (mockChannel) {
    mock = createMockChannel({ name: "mock" });
    adapters.push(mock);
  } else {
    if (cfg.telegram.enabled) {
      if (!cfg.telegram.token) throw new Error("TELEGRAM_BOT_TOKEN required when telegram.enabled");
      adapters.push(createTelegramAdapter({ token: cfg.telegram.token }));
    }
    if (cfg.slack.enabled) {
      if (!cfg.slack.botToken || !cfg.slack.signingSecret) {
        throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET required when slack.enabled");
      }
      slack = createSlackAdapter({
        botToken: cfg.slack.botToken,
        signingSecret: cfg.slack.signingSecret,
      });
      adapters.push(slack);
    }
    if (cfg.feishu.enabled) {
      if (!cfg.feishu.appId || !cfg.feishu.appSecret || !cfg.feishu.verificationToken) {
        throw new Error("FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_VERIFICATION_TOKEN required");
      }
      feishu = createFeishuAdapter({
        appId: cfg.feishu.appId,
        appSecret: cfg.feishu.appSecret,
        verificationToken: cfg.feishu.verificationToken,
      });
      adapters.push(feishu);
    }
    if (adapters.length === 0) {
      throw new Error(
        "no channels enabled — set tah.channels.json or pass --mock-channel for local demo",
      );
    }
  }

  const engine = await createChannelHostEngine({
    persistDir: cfg.persistDir,
    adapters,
    // --mock-channel 仅假 IM；真 LLM 由是否传 --mock 决定
    mockLlm: flags.mock || mockChannel,
  });

  const needHttp = Boolean(slack || feishu);
  let server: Server | undefined;
  let port = cfg.port;
  const host = "127.0.0.1";

  if (needHttp) {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${host}`);
      void (async () => {
        try {
          if (req.method === "POST" && url.pathname === "/hooks/slack" && slack) {
            await slack.handleHttp(req, res);
            return;
          }
          if (req.method === "POST" && url.pathname === "/hooks/feishu" && feishu) {
            await feishu.handleHttp(req, res);
            return;
          }
          if (req.method === "GET" && url.pathname === "/health") {
            res.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({ ok: true, persistDir: cfg.persistDir }),
            );
            return;
          }
          res.writeHead(404).end("not found");
        } catch (err) {
          console.error("[channel-host] http:", err);
          if (!res.headersSent) res.writeHead(500).end("error");
        }
      })();
    });
    port = await listen(server, host, cfg.port);
  }

  return {
    url: needHttp ? `http://${host}:${port}` : `channel-host://mock`,
    persistDir: cfg.persistDir,
    ...(mock ? { mock } : {}),
    async stop() {
      await engine.stop();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
    },
  };
}

export async function runChannelHost(flags: CliFlags): Promise<void> {
  const started = await startChannelHost(flags);
  console.log(`[tah] channel-host persist → ${started.persistDir}`);
  if (started.url.startsWith("http")) {
    console.log(`[tah] hooks on ${started.url}  (/hooks/slack /hooks/feishu)`);
  }
  if (flags.mockChannel) {
    console.log(`[tah] --mock-channel: inject via test or demo script`);
  }
  console.log(
    `[tah] optional panel: tah serve --super-agent-panel ${path.relative(flags.cwd, started.persistDir) || started.persistDir}`,
  );
  console.log("[tah] Ctrl+C to stop");
  await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  process.once("SIGINT", () => process.exit(130));
  await started.stop();
}
