import type { ApprovalAnswer } from "@typescript-agent-harness/permissions";

/** `GET /api/info`; `maxSteps` is null when unlimited. */
export type ServeInfo = { approve: boolean; maxSteps: number | null; version: string };

/** Request bodies of the `POST /api/*` commands that take one. */
export type ServeRequest = {
  auth: { token: string };
  send: { text: string };
  answer: { id: string; answer: ApprovalAnswer };
  resume: { ref: string };
  fork: { turns?: number };
};

/** Body of every 4xx response. */
export type ServeError = { error: string };
