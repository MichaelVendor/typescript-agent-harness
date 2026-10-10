import { defineTool } from "@typescript-agent-harness/cli";
import { linkTo, releases } from "../lib/docs.ts";

export default defineTool({
  description:
    "Release notes from CHANGELOG.md. Without `version`: the latest release. `0.22` returns every 0.22.x; `0.22.5` just that one.",
  inputSchema: {
    type: "object",
    properties: { version: { type: "string", description: 'e.g. "0.22" or "0.22.5"; omit for the latest' } },
  },
  async execute(input: { version?: string }) {
    const all = releases();
    const wanted = input.version?.replace(/^v/, "");
    const found = wanted ? all.filter((r) => r.version === wanted || r.version.startsWith(`${wanted}.`)) : all.slice(0, 1);
    return {
      latest: all[0]?.version,
      releases: found,
      link: linkTo("CHANGELOG.md"),
      ...(found.length === 0 ? { note: `no release ${input.version} in CHANGELOG.md` } : {}),
    };
  },
});
