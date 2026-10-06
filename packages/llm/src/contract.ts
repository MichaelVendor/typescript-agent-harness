import { createServiceKey } from "@typescript-agent-harness/core";
import type { LLMService } from "./types.js";

export const LLM = createServiceKey<LLMService>("llm");
