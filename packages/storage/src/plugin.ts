import type { Plugin } from "@typescript-agent-harness/core";
import { STORAGE } from "./contract.js";
import { createMemoryStorage } from "./memory.js";
import { createSqliteStorage } from "./sqlite.js";

export type StoragePluginOptions = {
  driver?: "memory" | "sqlite";
  path?: string;
};

export function storagePlugin(options: StoragePluginOptions = {}): Plugin {
  const driver = options.driver ?? "sqlite";
  const filePath = options.path ?? ".tah/data.db";

  return {
    name: "storage",
    setup(ctx) {
      const service =
        driver === "memory"
          ? createMemoryStorage()
          : createSqliteStorage(filePath);
      ctx.provide(STORAGE, service);
    },
  };
}
