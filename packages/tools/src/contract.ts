import { createServiceKey } from "@typescript-agent-harness/core";
import type { ToolService } from "./types.js";

export const TOOLS = createServiceKey<ToolService>("tools");
