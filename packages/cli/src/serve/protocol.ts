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

/** `GET /api/workspaces/recent`. */
export type RecentFolder = { path: string; name: string };

/** `GET /api/fs`: sub-folders of `path`; `parent` is null at the root; `crumbs` runs from the root down to `path`. */
export type DirListing = { path: string; parent: string | null; dirs: string[]; crumbs: { name: string; path: string }[] };
