import type { Context, Plugin } from "@typescript-agent-harness/core";
import type { ToolCall } from "@typescript-agent-harness/llm";
import { PERMISSIONS } from "@typescript-agent-harness/permissions";
import { TOOLS } from "./contract.js";
import type { Tool, ToolContext, ToolResult, ToolService } from "./types.js";

export type ToolsPluginOptions = {
  tools?: Tool[];
};

function createToolService(ctx: Context, initial: Tool[]): ToolService {
  const registry = new Map<string, Tool>();
  for (const tool of initial) {
    if (registry.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    registry.set(tool.name, tool);
  }

  return {
    register(tool) {
      if (registry.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      registry.set(tool.name, tool);
    },
    list() {
      const perms = ctx.tryGet(PERMISSIONS);
      const all = [...registry.values()];
      return perms ? all.filter((t) => perms.visible(t.name)) : all;
    },
    listSchemas() {
      return this.list().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    async execute(call: ToolCall, toolCtx: ToolContext): Promise<ToolResult> {
      const perms = ctx.tryGet(PERMISSIONS);
      if (perms) {
        const decision = perms.check(call.name, call.arguments);
        if (!decision.allow) {
          await ctx.emit("permission.denied", {
            tool: call.name,
            reason: decision.reason,
          });
          const result: ToolResult = {
            callId: call.id,
            name: call.name,
            ok: false,
            output: { error: decision.reason },
          };
          await ctx.emit("tool.failed", {
            callId: call.id,
            tool: call.name,
            error: result.output,
          });
          return result;
        }
        await ctx.emit("permission.granted", { tool: call.name });
      }
      const tool = registry.get(call.name);
      await ctx.emit("tool.started", {
        callId: call.id,
        tool: call.name,
        input: call.arguments,
      });
      if (!tool) {
        const result: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: false,
          output: { error: `unknown tool: ${call.name}` },
        };
        await ctx.emit("tool.failed", {
          callId: call.id,
          tool: call.name,
          error: result.output,
        });
        return result;
      }
      try {
        const output = await tool.execute(call.arguments, toolCtx);
        const result: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: true,
          output,
        };
        await ctx.emit("tool.finished", {
          callId: call.id,
          tool: call.name,
          output,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const result: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: false,
          output: { error: message },
        };
        await ctx.emit("tool.failed", {
          callId: call.id,
          tool: call.name,
          error: message,
        });
        return result;
      }
    },
  };
}

export function toolsPlugin(options: ToolsPluginOptions = {}): Plugin {
  return {
    name: "tools",
    setup(ctx) {
      ctx.provide(TOOLS, createToolService(ctx, options.tools ?? []));
    },
  };
}
