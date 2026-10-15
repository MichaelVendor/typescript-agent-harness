import type { ApprovalAnswer } from "@typescript-agent-harness/permissions";
import type { AttachmentMeta } from "../attachments/store.js";
import type { SessionRow } from "../sessions.js";

/** `GET /api/info`; `maxSteps` is null when unlimited; `desktop` is where "New folder" starts (home when there is no Desktop). */
export type ServeInfo = { approve: boolean; maxSteps: number | null; version: string; vision: boolean; desktop: string };

/** Request bodies of the `POST /api/*` commands that take one. */
export type ServeRequest = {
  auth: { token: string };
  send: { text?: string; attachmentIds?: string[] };
  answer: { id: string; answer: ApprovalAnswer };
  /** Answers a `question` event: one list per question, in order. */
  question: { id: string; answers: string[][] };
  /** `cwd`: start the session in that folder (switching to it first). */
  reset: { cwd?: string };
  resume: { ref: string; cwd?: string };
  /** `id`: fork that session (switching folder / session first) instead of the current one. */
  fork: { turns?: number; id?: string; cwd?: string };
  rename: { id: string; title: string; cwd?: string };
  sessionFlag: { id: string; flag: "pinned" | "archived"; on: boolean; cwd?: string };
  workspace: { path: string };
  mkdir: { path: string; name: string };
  addModel: { model: string; apiKey: string; baseURL?: string; vision?: boolean };
  removeModel: { id: string };
  /** Whether the model reads images (image attachments are sent to it). */
  modelVision: { id: string; vision: boolean };
  /** `null` goes back to `.env`. */
  activeModel: { id: string | null };
  /** Tavily API key; `null` removes it. */
  searchKey: { apiKey: string | null };
  /** A skill folder, or a folder of skill folders (e.g. `~/.cursor/skills`), copied into `~/.tah/skills`. */
  importSkills: { path: string };
  /** Only skills in `~/.tah/skills` can be removed here. */
  removeSkill: { name: string };
  /** System folder dialog starting at `start`; answers `{ path: string | null }` (null = cancelled), 501 when unavailable. */
  choose: { start?: string };
  /** `url`: http(s) (not tah itself), `about:blank`, or a `/preview/…` address; omitted = just start the browser. */
  browserOpen: { url?: string };
  browserNav: { action: "back" | "reload" };
  browserTab: { id: string };
  /** `text` answers a `prompt` dialog. */
  browserDialog: { accept: boolean; text?: string };
};

export type { AttachmentMeta };

/** Body of every 4xx response. */
export type ServeError = { error: string };

/** `GET /api/workspaces`: one entry per folder in the sidebar. */
export type WorkspaceView = {
  path: string;
  name: string;
  active: boolean;
  missing?: true;
  /** Why this folder's sessions could not be read. */
  error?: string;
  sessions: SessionRow[];
};

/** `GET /api/settings`; API keys only ever leave the server as `keyHint`. `baseURL` is the effective one. */
export type SettingsView = {
  user: string;
  models: { id: string; model: string; baseURL: string; keyHint: string; vision: boolean }[];
  activeModel: string | null;
  /** What `.env` / the environment gives when no model is active; `key` is the variable's name. `null` = no key there. */
  env: { model: string; key: "DEEPSEEK_API_KEY" | "OPENAI_API_KEY" } | null;
  /** Tavily key for `web_search`: from settings (removable here) or `TAVILY_API_KEY`; `null` = web_search is off. */
  search: { source: "settings" | "env"; keyHint: string } | null;
};

/** `GET /api/skills`: what the open folder loads. `home` = `~/.tah/skills` (every folder); `folder` = inside the open folder. */
export type SkillsView = {
  skills: { name: string; description: string; source: "home" | "folder"; path: string }[];
};

/** `POST /api/skills/import`; `skipped` entries read `<name>: <reason>`. */
export type SkillsImport = SkillsView & { imported: string[]; skipped: string[] };

/** `GET /api/workspaces/recent`. */
export type RecentFolder = { path: string; name: string };

/** `GET /api/fs`: sub-folders of `path`; `parent` is null at the root; `crumbs` runs from the root down to `path`. */
export type DirListing = { path: string; parent: string | null; dirs: string[]; crumbs: { name: string; path: string }[] };

/** How the preview panel shows a file. */
export type FileKind = "image" | "pdf" | "video" | "html" | "markdown" | "text" | "binary";

/** `GET /api/files/stat`: `path` is relative to the open folder (`/`-separated); `mtime` in ms; `previewURL` only for `html`. */
export type FileStat = { path: string; kind: FileKind; bytes: number; mtime: number; previewURL?: string };

/** `GET /api/browser` and the `state` events of `GET /api/browser/stream`. */
export type BrowserState = {
  /** The open folder has the built-in browser (`capabilities.browser`, not `--mock`). */
  available: boolean;
  /** Playwright MCP is running. */
  running: boolean;
  /** The agent's `browser_open` was approved; its browser tools are mounted. */
  agent: boolean;
  tabs: { id: string; title: string; url: string }[];
  /** The tab the panel shows. */
  active: string | null;
  /** Why the browser last failed to start, or to show the active tab. */
  error?: string;
  /** A JavaScript dialog the shown tab is waiting on; the page takes no input until it is answered. */
  dialog?: BrowserDialog;
};

export type BrowserDialog = { type: "alert" | "confirm" | "prompt" | "beforeunload"; message: string };

/** `POST /api/browser/input`: coordinates in page CSS pixels; `modifiers` bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export type BrowserInput =
  | {
      type: "mouse";
      event: "move" | "down" | "up";
      x: number;
      y: number;
      button: "left" | "middle" | "right" | "none";
      clickCount: number;
      modifiers: number;
    }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number; modifiers: number }
  | { type: "key"; event: "down" | "up"; key: string; code: string; keyCode: number; modifiers: number; text?: string }
  | { type: "text"; text: string };

/** One event of `GET /api/browser/stream`; a frame's `data` is a base64 JPEG, `width` / `height` the page size in CSS pixels. */
export type BrowserStreamEvent =
  | { type: "state"; state: BrowserState }
  | { type: "frame"; data: string; width: number; height: number };
