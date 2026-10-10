import type { Plugin } from "@typescript-agent-harness/core";
import type { Tool } from "@typescript-agent-harness/tools";

export type { Context, Plugin } from "@typescript-agent-harness/core";
export type { Tool, ToolContext } from "@typescript-agent-harness/tools";
export type { ApprovalAnswer } from "@typescript-agent-harness/permissions";
export type { HistoryItem, HostEvent, SessionEvent } from "./host.js";
export type { SessionRow } from "./sessions.js";
export type { ServeError, ServeInfo, ServeRequest } from "./serve/protocol.js";

/** A file in `tools/`; `name` defaults to the file name with `-` → `_`. */
export type ProjectTool<TInput = unknown, TOutput = unknown> = Omit<Tool<TInput, TOutput>, "name"> & {
  name?: string;
};

/** A file in `plugins/`; `name` defaults to `project:<file name>`. */
export type ProjectPlugin = Omit<Plugin, "name"> & { name?: string };

export function defineTool<TInput, TOutput>(
  tool: ProjectTool<TInput, TOutput>,
): ProjectTool<TInput, TOutput> {
  return tool;
}

export function definePlugin(plugin: ProjectPlugin): ProjectPlugin {
  return plugin;
}
