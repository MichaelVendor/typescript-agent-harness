import type { Plugin } from "@typescript-agent-harness/core";
import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { BRIEF_SAVED, briefSaved } from "../lib/events.ts";
import { REPORT_SAVED, reportSaved } from "../lib/selection/events.ts";
import { PROJECT_ROOT } from "../lib/save.ts";

/**
 * 复盘日志：工具结束写入 out/run-log.jsonl；简报/选品落盘打 stderr。
 */
type ToolFinished = {
  call?: { name?: string };
  name?: string;
  ok?: boolean;
  output?: unknown;
};

function extractId(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const id = (output as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function extractAsin(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const asin = (output as { asin?: unknown }).asin;
  return typeof asin === "string" ? asin : undefined;
}

async function appendLine(file: string, line: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${line}\n`, "utf8");
}

export default {
  name: "project:run-log",
  setup(ctx) {
    ctx.on("tool.finished", async (event) => {
      const e = (event ?? {}) as ToolFinished;
      const name = e.call?.name ?? e.name;
      if (!name) return;
      const entry = {
        at: new Date().toISOString(),
        tool: name,
        ok: e.ok ?? true,
        id: extractId(e.output),
        asin: extractAsin(e.output),
      };
      await appendLine(path.join(PROJECT_ROOT, "out", "run-log.jsonl"), JSON.stringify(entry));
    });

    ctx.on(BRIEF_SAVED, (event: unknown) => {
      const payload = briefSaved(event);
      if (!payload) return;
      process.stderr.write(
        `[brief-agent] brief saved → ${payload.mdPath}（json: ${payload.jsonPath}）\n`,
      );
    });

    ctx.on(REPORT_SAVED, (event: unknown) => {
      const payload = reportSaved(event);
      if (!payload) return;
      process.stderr.write(
        `[brief-agent] report saved → ${payload.file}（${payload.candidates} 个候选）\n`,
      );
    });
  },
} satisfies Plugin;
