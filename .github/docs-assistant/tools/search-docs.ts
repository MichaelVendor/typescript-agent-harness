import { defineTool } from "@typescript-agent-harness/cli";
import { searchDocs } from "../lib/docs.ts";

export default defineTool({
  description:
    "Search the typescript-agent-harness (tah) docs: docs/, README, CHANGELOG, CONTRIBUTING. Returns matching lines with the file path (pass it to read_doc for the whole file) and a link to cite.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'Space-separated keywords, e.g. "自定义工具 defineTool tools/". Lines containing any keyword are returned, lines with more keywords first. Prefer short terms over full sentences.',
      },
    },
    required: ["query"],
  },
  async execute(input: { query: string }) {
    return searchDocs(input.query);
  },
});
