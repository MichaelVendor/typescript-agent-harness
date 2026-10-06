import type { Plugin } from "@typescript-agent-harness/core";
import { PERMISSIONS } from "./contract.js";
import type { PermissionDecision, PermissionService } from "./types.js";

export type PermissionsPluginOptions = {
  /** If set, only these tools are visible and executable. */
  allow?: string[];
  /** Always blocked, even if also in allow. */
  deny?: string[];
};

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
    },
  };
}
