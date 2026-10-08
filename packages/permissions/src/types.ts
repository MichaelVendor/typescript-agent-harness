export type PermissionDecision =
  | { allow: true }
  | { allow: false; reason: string };

export type PermissionService = {
  check(tool: string, input: unknown): PermissionDecision;
  /** If false, hide the tool from the model schema. */
  visible(tool: string): boolean;
};

/** Structural view of the tools package `ToolExecution` / `ToolResult` (no import: tools depends on us). */
export type GuardedCall = {
  call: { id: string; name: string; arguments: unknown };
  ctx?: { signal: AbortSignal };
};

export type GuardedResult = {
  callId: string;
  name: string;
  ok: boolean;
  output: unknown;
};
