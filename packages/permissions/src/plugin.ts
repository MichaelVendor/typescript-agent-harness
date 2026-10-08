import type { Context, Plugin } from "@typescript-agent-harness/core";
import { PERMISSIONS, TOOL_EXECUTE } from "./contract.js";
import type {
  GuardedCall,
  GuardedResult,
  PermissionDecision,
  PermissionService,
} from "./types.js";

export type PermissionsPluginOptions = {
  /** If set, only these tools are visible and executable. */
  allow?: string[];
  /** Always blocked, even if also in allow. */
  deny?: string[];
};

export async function rejectCall(
  ctx: Context,
  call: GuardedCall["call"],
  reason: string,
): Promise<GuardedResult> {
  await ctx.emit("permission.denied", { tool: call.name, reason });
  const result: GuardedResult = {
    callId: call.id,
    name: call.name,
    ok: false,
    output: { error: reason },
  };
  await ctx.emit("tool.failed", {
    callId: call.id,
    tool: call.name,
    error: result.output,
  });
  return result;
}

export function permissionsPlugin(options: PermissionsPluginOptions = {}): Plugin {
  const allow = options.allow ? new Set(options.allow) : undefined;
  const deny = new Set(options.deny ?? []);

  const service: PermissionService = {
    check(tool): PermissionDecision {
      if (deny.has(tool)) {
        return { allow: false, reason: `tool denied by policy: ${tool}` };
      }
      if (allow && !allow.has(tool)) {
        return { allow: false, reason: `tool not in allowlist: ${tool}` };
      }
      return { allow: true };
    },
    visible(tool) {
      return this.check(tool, undefined).allow;
    },
  };

  return {
    name: "permissions",
    setup(ctx) {
      ctx.provide(PERMISSIONS, service);
      ctx.intercept<GuardedCall, GuardedResult>(TOOL_EXECUTE, async (p, next) => {
        const decision = service.check(p.call.name, p.call.arguments);
        if (!decision.allow) return rejectCall(ctx, p.call, decision.reason);
        await ctx.emit("permission.granted", { tool: p.call.name });
        return next(p);
      });
    },
  };
}
