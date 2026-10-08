import type { Plugin } from "@typescript-agent-harness/core";
import { TOOL_EXECUTE } from "./contract.js";
import { rejectCall } from "./plugin.js";
import type { GuardedCall, GuardedResult } from "./types.js";

export type ApprovalAnswer = "yes" | "no" | "always";

export type ApprovalPluginOptions = {
  /** Tools that need a human answer before each call. */
  tools: string[];
  /** "always" skips the question for that tool until the runtime stops. Resolve "no" once `signal` aborts. */
  ask(call: GuardedCall["call"], signal?: AbortSignal): Promise<ApprovalAnswer>;
};

export function approvalPlugin(options: ApprovalPluginOptions): Plugin {
  const gated = new Set(options.tools);
  const always = new Set<string>();

  return {
    name: "approval",
    setup(ctx) {
      always.clear();
      ctx.intercept<GuardedCall, GuardedResult>(TOOL_EXECUTE, async (p, next) => {
        const name = p.call.name;
        if (!gated.has(name) || always.has(name)) return next(p);
        const answer = await options.ask(p.call, p.ctx?.signal);
        if (answer === "no") {
          return rejectCall(
            ctx,
            p.call,
            `rejected by user: ${name}. Do not retry the same call; ask the user what to do instead.`,
          );
        }
        if (answer === "always") always.add(name);
        return next(p);
      });
    },
  };
}
