import { createServiceKey } from "@typescript-agent-harness/core";
import type { PermissionService } from "./types.js";

export const PERMISSIONS = createServiceKey<PermissionService>("permissions");

/** Must equal `TOOL_EXECUTE` in the tools package. */
export const TOOL_EXECUTE = "tool.execute";
