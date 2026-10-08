import { createServiceKey } from "@typescript-agent-harness/core";
import type { ToolService } from "./types.js";

export const TOOLS = createServiceKey<ToolService>("tools");

/** Waterfall wrapping every tool call: payload `ToolExecution`, result `ToolResult`. */
export const TOOL_EXECUTE = "tool.execute";
