import type { ApprovalAnswer } from "@typescript-agent-harness/permissions";
import type { AttachmentMeta } from "../attachments/store.js";
import type { SessionRow } from "../sessions.js";

/** `GET /api/info`; `maxSteps` is null when unlimited. */
export type ServeInfo = { approve: boolean; maxSteps: number | null; version: string; vision: boolean };

/** Request bodies of the `POST /api/*` commands that take one. */
export type ServeRequest = {
  auth: { token: string };
  send: { text?: string; attachmentIds?: string[] };
  answer: { id: string; answer: ApprovalAnswer };
  resume: { ref: string };
  fork: { turns?: number };
  rename: { id: string; title: string };
  sessionFlag: { id: string; flag: "pinned" | "archived"; on: boolean };
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

/** `GET /api/fs`: sub-folders of `path`; `parent` is null at the root. */
export type DirListing = { path: string; parent: string | null; dirs: string[] };
