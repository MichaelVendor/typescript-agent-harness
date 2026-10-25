import type {
  AttachmentMeta,
  BrowserInput,
  BrowserState,
  BrowserStreamEvent,
  DirListing,
  FileStat,
  HostEvent,
  RecentFolder,
  ServeError,
  ServeInfo,
  ServeRequest,
  SettingsView,
  SkillsImport,
  SkillsView,
  WorkspaceView,
} from "@typescript-agent-harness/cli";
import { fileQuery, type FileTarget } from "./preview-view";

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

/** Address of a file's bytes; `v` changes with the file, so the browser never shows a stale copy. */
export function fileRawURL(target: FileTarget, mtime: number): string {
  return `/api/files/raw?${fileQuery(target)}&v=${mtime}`;
}

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
  compact: () => post("/api/compact"),
  cancel: () => post("/api/cancel"),
  answer: (body: ServeRequest["answer"]) => post("/api/answer", body),
  mode: (body: ServeRequest["mode"]) => post("/api/mode", body),
  names: async (q: string) =>
    (await (await call("GET", `/api/files/names?q=${encodeURIComponent(q)}`)).json()) as { files: string[] },
  question: (body: ServeRequest["question"]) => post("/api/question", body),
  queue: (body: ServeRequest["queue"]) => post("/api/queue", body),
  reset: (body: ServeRequest["reset"] = {}) => post("/api/reset", body),
  workspaces: async () => (await (await call("GET", "/api/workspaces")).json()) as WorkspaceView[],
  recent: async () => (await (await call("GET", "/api/workspaces/recent")).json()) as RecentFolder[],
  addWorkspace: (body: ServeRequest["workspace"]) => post("/api/workspaces/add", body),
  removeWorkspace: (body: ServeRequest["workspace"]) => post("/api/workspaces/remove", body),
  fs: async (path?: string) =>
    (await (await call("GET", `/api/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`)).json()) as DirListing,
  choose: async (body: ServeRequest["choose"] = {}) =>
    ((await (await call("POST", "/api/fs/choose", body)).json()) as { path: string | null }).path,
  mkdir: async (body: ServeRequest["mkdir"]) => (await (await call("POST", "/api/fs/mkdir", body)).json()) as { path: string },
  resume: (body: ServeRequest["resume"]) => post("/api/resume", body),
  fork: (body: ServeRequest["fork"] = {}) => post("/api/fork", body),
  rename: async (body: ServeRequest["rename"]) =>
    (await (await call("POST", "/api/rename", body)).json()) as { id: string; title: string | null },
  sessionFlag: (body: ServeRequest["sessionFlag"]) => post("/api/session-flag", body),
  settings: async () => (await (await call("GET", "/api/settings")).json()) as SettingsView,
  addModel: async (body: ServeRequest["addModel"]) =>
    (await (await call("POST", "/api/settings/models", body)).json()) as SettingsView,
  removeModel: async (body: ServeRequest["removeModel"]) =>
    (await (await call("POST", "/api/settings/models/remove", body)).json()) as SettingsView,
  modelVision: async (body: ServeRequest["modelVision"]) =>
    (await (await call("POST", "/api/settings/models/vision", body)).json()) as SettingsView,
  activeModel: async (body: ServeRequest["activeModel"]) =>
    (await (await call("POST", "/api/settings/active", body)).json()) as SettingsView,
  searchKey: async (body: ServeRequest["searchKey"]) =>
    (await (await call("POST", "/api/settings/search", body)).json()) as SettingsView,
  fileStat: async (target: FileTarget) =>
    (await (await call("GET", `/api/files/stat?${fileQuery(target)}`)).json()) as FileStat,
  /** The first `limit` bytes as text. */
  async fileText(target: FileTarget, mtime: number, limit: number): Promise<string> {
    const res = await fetch(fileRawURL(target, mtime), { headers: { range: `bytes=0-${limit - 1}` } });
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
    return res.text();
  },
  skills: async () => (await (await call("GET", "/api/skills")).json()) as SkillsView,
  importSkills: async (body: ServeRequest["importSkills"]) =>
    (await (await call("POST", "/api/skills/import", body)).json()) as SkillsImport,
  removeSkill: async (body: ServeRequest["removeSkill"]) =>
    (await (await call("POST", "/api/skills/remove", body)).json()) as SkillsView,
  browserState: async () => (await (await call("GET", "/api/browser")).json()) as BrowserState,
  browserOpen: async (body: ServeRequest["browserOpen"] = {}) =>
    (await (await call("POST", "/api/browser/open", body)).json()) as BrowserState,
  browserNav: (body: ServeRequest["browserNav"]) => post("/api/browser/nav", body),
  browserTab: (body: ServeRequest["browserTab"]) => post("/api/browser/tab", body),
  browserInput: (input: BrowserInput) => post("/api/browser/input", input),
  browserDialog: (body: ServeRequest["browserDialog"]) => post("/api/browser/dialog", body),
  browserClose: () => post("/api/browser/close"),
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

/** The browser panel's stream: `state` on every change, the shown tab's frames while connected. */
export function browserStream(onEvent: (event: BrowserStreamEvent) => void): () => void {
  const source = new EventSource("/api/browser/stream");
  source.onmessage = (message) => onEvent(JSON.parse(message.data as string) as BrowserStreamEvent);
  return () => source.close();
}
