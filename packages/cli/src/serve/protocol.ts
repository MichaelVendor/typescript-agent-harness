import type { ApprovalAnswer } from "@typescript-agent-harness/permissions";
import type { AttachmentMeta } from "../attachments/store.js";

/** `GET /api/info`; `maxSteps` is null when unlimited. */
export type ServeInfo = { approve: boolean; maxSteps: number | null; version: string; vision: boolean };

/** Request bodies of the `POST /api/*` commands that take one. */
export type ServeRequest = {
  auth: { token: string };
  send: { text?: string; attachmentIds?: string[] };
  answer: { id: string; answer: ApprovalAnswer };
  resume: { ref: string };
  fork: { turns?: number };
};

export type { AttachmentMeta };

/** Body of every 4xx response. */
export type ServeError = { error: string };
