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
