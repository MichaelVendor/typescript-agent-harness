/** What a session will do before a mutating tool runs. */
export const PERMISSION_MODES = ["manual", "accept-edits", "plan"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

const EDITS = new Set(["write_file", "edit_file"]);
const MUTATIONS = new Set(["write_file", "edit_file", "execute_command", "browser_open", "browser_file_upload"]);

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "manual" || value === "accept-edits" || value === "plan";
}

/** `yes` and `no` skip the prompt; `ask` leaves it to the user. */
export function decide(mode: PermissionMode, tool: string): "ask" | "yes" | "no" {
  if (mode === "accept-edits" && EDITS.has(tool)) return "yes";
  if (mode === "plan" && MUTATIONS.has(tool)) return "no";
  return "ask";
}

export function cycleMode(mode: PermissionMode): PermissionMode {
  const index = PERMISSION_MODES.indexOf(mode);
  return PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length] ?? "manual";
}
