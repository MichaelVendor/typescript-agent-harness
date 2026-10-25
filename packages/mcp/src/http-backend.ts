import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { backendFromClient, type McpClientLike } from "./client-backend.js";
import type { McpBackend } from "./types.js";

export type HttpConnectKind = "streamable" | "sse";

async function defaultConnectKind(
  kind: HttpConnectKind,
  url: string,
  headers: Record<string, string>,
): Promise<McpClientLike> {
  const Transport =
    kind === "streamable" ? StreamableHTTPClientTransport : SSEClientTransport;
  const client = new Client({ name: "typescript-agent-harness", version: "1.6.0" });
  await client.connect(new Transport(new URL(url), { requestInit: { headers } }));
  return client;
}

/** MCP over remote HTTP; tries Streamable HTTP, then SSE. */
export function httpMcpBackend(options: {
  url: string;
  headers?: Record<string, string>;
  /** Test seam. Production tries streamable, then sse. */
  connectKind?: (
    kind: HttpConnectKind,
    url: string,
    headers: Record<string, string>,
  ) => Promise<{ close(): Promise<void> }>;
}): McpBackend {
  const headers = options.headers ?? {};
  const connectKind = options.connectKind ?? defaultConnectKind;
  let client: McpClientLike | undefined;
  let started: Promise<McpClientLike> | undefined;

  function ensure(): Promise<McpClientLike> {
    if (!started) {
      started = (async (): Promise<McpClientLike> => {
        let streamErr: unknown;
        try {
          const c = (await connectKind(
            "streamable",
            options.url,
            headers,
          )) as McpClientLike;
          client = c;
          return c;
        } catch (err) {
          streamErr = err;
        }
        try {
          const c = (await connectKind("sse", options.url, headers)) as McpClientLike;
          client = c;
          return c;
        } catch (sseErr) {
          const streamReason =
            streamErr instanceof Error ? streamErr.message : String(streamErr);
          const sseReason = sseErr instanceof Error ? sseErr.message : String(sseErr);
          throw new Error(
            `MCP server failed (${options.url}): Streamable HTTP: ${streamReason}; SSE: ${sseReason}`,
          );
        }
      })();
    }
    return started;
  }

  return backendFromClient({
    listTools: async () => (await ensure()).listTools(),
    callTool: async (args) => (await ensure()).callTool(args),
    listResources: async () => (await ensure()).listResources(),
    readResource: async (args) => (await ensure()).readResource(args),
    listPrompts: async () => (await ensure()).listPrompts(),
    getPrompt: async (args) => (await ensure()).getPrompt(args),
    close: async () => {
      const c = client;
      client = undefined;
      started = undefined;
      await c?.close();
    },
  });
}
