export type PermissionDecision =
  | { allow: true }
  | { allow: false; reason: string };

export type PermissionService = {
  check(tool: string, input: unknown): PermissionDecision;
  /** If false, hide the tool from the model schema. */
  visible(tool: string): boolean;
};
