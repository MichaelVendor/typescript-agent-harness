import { defineTool } from "@typescript-agent-harness/cli";
import { readDoc } from "../lib/docs.ts";

export default defineTool({
  description: "Read a whole doc file. `path` is a path returned by search_docs, e.g. docs/guide/cli.md.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async execute(input: { path: string }) {
    return readDoc(input.path);
  },
});
