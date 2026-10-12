import type {
  AttachmentMeta,
  DirListing,
  HostEvent,
  RecentFolder,
  ServeError,
  ServeInfo,
  ServeRequest,
  WorkspaceView,
} from "@typescript-agent-harness/cli";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const res = await fetch(path, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : {},
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  if (!res.ok) {
    const error = ((await res.json().catch(() => undefined)) as ServeError | undefined)?.error;
    throw new ApiError(res.status, error ?? `${res.status} ${res.statusText}`);
  }
  return res;
}

const post = (path: string, body?: unknown) => call("POST", path, body).then(() => undefined);

export const api = {
  auth: (body: ServeRequest["auth"]) => post("/api/auth", body),
  info: async () => (await (await call("GET", "/api/info")).json()) as ServeInfo,
  send: (body: ServeRequest["send"]) => post("/api/send", body),
  async upload(file: File): Promise<AttachmentMeta> {
    const res = await fetch("/api/attachments", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-tah-filename": encodeURIComponent(file.name),
        "x-tah-mime": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) {
      const error = ((await res.json().catch(() => undefined)) as ServeError | undefined)?.error;
      throw new ApiError(res.status, error ?? `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as AttachmentMeta;
  },
  continueTurn: () => post("/api/continue"),
  cancel: () => post("/api/cancel"),
  answer: (body: ServeRequest["answer"]) => post("/api/answer", body),
  reset: (body: ServeRequest["reset"] = {}) => post("/api/reset", body),
  workspaces: async () => (await (await call("GET", "/api/workspaces")).json()) as WorkspaceView[],
  recent: async () => (await (await call("GET", "/api/workspaces/recent")).json()) as RecentFolder[],
  addWorkspace: (body: ServeRequest["workspace"]) => post("/api/workspaces/add", body),
  removeWorkspace: (body: ServeRequest["workspace"]) => post("/api/workspaces/remove", body),
  fs: async (path?: string) =>
    (await (await call("GET", `/api/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`)).json()) as DirListing,
  mkdir: async (body: ServeRequest["mkdir"]) => (await (await call("POST", "/api/fs/mkdir", body)).json()) as { path: string },
  resume: (body: ServeRequest["resume"]) => post("/api/resume", body),
  fork: (body: ServeRequest["fork"] = {}) => post("/api/fork", body),
  rename: async (body: ServeRequest["rename"]) =>
    (await (await call("POST", "/api/rename", body)).json()) as { id: string; title: string | null },
  sessionFlag: (body: ServeRequest["sessionFlag"]) => post("/api/session-flag", body),
};

export type Connection = "connecting" | "open" | "reconnecting" | "signed-out";

/**
 * Streams host events. Each (re)connect first calls `onOpen`, then the server replays the state so far.
 * EventSource hides HTTP status, so a failed connect asks `/api/info` whether the cookie is gone.
 */
export function connect(handlers: {
  onOpen(): void;
  onEvent(event: HostEvent): void;
  onStatus(status: Connection): void;
}): () => void {
  const source = new EventSource("/api/events");
  source.onopen = () => {
    handlers.onOpen();
    handlers.onStatus("open");
  };
  source.onmessage = (message) => handlers.onEvent(JSON.parse(message.data as string) as HostEvent);
  source.onerror = () => {
    handlers.onStatus("reconnecting");
    api.info().catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        source.close();
        handlers.onStatus("signed-out");
      }
    });
  };
  return () => source.close();
}
