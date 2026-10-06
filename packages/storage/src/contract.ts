import { createServiceKey } from "@typescript-agent-harness/core";
import type { StorageService } from "./types.js";

export const STORAGE = createServiceKey<StorageService>("storage");
