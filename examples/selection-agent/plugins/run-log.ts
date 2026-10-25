import type { Plugin } from "@typescript-agent-harness/core";
import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { REPORT_SAVED, reportSaved } from "../lib/events.ts";
import { PROJECT_ROOT } from "../lib/report.ts";

/**
 * 复盘日志：每次工具调用结束时，把"模型查了哪个工具、查的是哪个 asin"
 * 追加到 <项目根>/out/run-log.jsonl。
 *
 * 为什么需要：选品结论必须能复盘——三个月后回看"这个商品当时排第一"时，
 * 要知道它查过哪些数据、有没有漏查一步就下了结论。
 */
type ToolFinished = {
  call?: { name?: string };
  name?: string;
  ok?: boolean;
  output?: unknown;
};

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
        // 只记 asin 这类可关联字段，避免把整块 mock 数据写进日志。
        asin: extractAsin(e.output),
      };
      await appendLine(path.join(PROJECT_ROOT, "out", "run-log.jsonl"), JSON.stringify(entry));
    });

    ctx.on(REPORT_SAVED, (event: unknown) => {
      const payload = reportSaved(event);
      if (!payload) return;
      // 报告路径写 stderr，不污染助手回复。
      process.stderr.write(
        `[selection-agent] report saved → ${payload.file}（${payload.candidates} 个候选）\n`,
      );
    });
  },
} satisfies Plugin;
