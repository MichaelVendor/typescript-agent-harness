import type { Context } from "./context.js";

/**
 * Everything is a capability — and every capability is mounted as a Plugin.
 */
export interface Plugin {
  readonly name: string;

  setup(ctx: Context): void | Promise<void>;

  dispose?(): void | Promise<void>;
}

export type PluginFactory = () => Plugin;
