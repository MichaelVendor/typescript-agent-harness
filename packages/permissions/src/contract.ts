import { createServiceKey } from "@typescript-agent-harness/core";
import type { PermissionService } from "./types.js";

export const PERMISSIONS = createServiceKey<PermissionService>("permissions");
