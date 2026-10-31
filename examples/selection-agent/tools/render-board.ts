import path from "node:path";
import { defineTool } from "@typescript-agent-harness/cli";
import { boardPage, type BoardRow } from "../lib/board-page.ts";
import { BOARD_REPLY, boardShotOfLatest, selectionImageMarkdown, writeBoardFiles } from "../lib/board-shot.ts";
import { loadListingImages } from "../lib/listing-images.ts";
import { PROJECT_ROOT } from "../lib/report.ts";
import { readdirSync, readFileSync } from "node:fs";

function latestReport(): { name: string; rows: BoardRow[] } {
  const dir = path.join(PROJECT_ROOT, "out", "reports");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  const name = files.at(-1);
  if (!name) throw new Error("还没有选品报告");
  const report = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as { rows?: BoardRow[] };
  if (!report.rows?.length) throw new Error("最近一份报告没有排行");
  return { name: name.replace(/\.json$/, ""), rows: report.rows };
}

/** 用最近一份报告的分数画 HTML，再截成 png。落盘时一般已经截过，这里给要改结论文案时用。 */
export default defineTool({
  description:
    "把最近一份选品报告画成 HTML 并截图。分数只用报告里的数字。结论、说明、缺口传即将写给用户的原文。返回的 imageMarkdown 贴在回复第一行。",
  inputSchema: {
    type: "object",
    properties: {
      conclusion: { type: "string", description: "结论那一句" },
      notes: { type: "string", description: "说明。一行一条，可写「为什么」和「要验」" },
      gaps: { type: "string", description: "缺口。一行一条" },
    },
    additionalProperties: false,
  },
  async execute(input: { conclusion?: string; notes?: string; gaps?: string }) {
    try {
      if (!input.conclusion && !input.notes && !input.gaps) {
        const shot = boardShotOfLatest();
        if ("imageError" in shot) return { error: shot.imageError, next: "截图没做成。四块文字照常写，不要声称已经有图。" };
        return { ...shot, next: BOARD_REPLY };
      }
      const { name, rows } = latestReport();
      const page = boardPage({ ...input, rows, images: loadListingImages() });
      const files = writeBoardFiles(path.join(PROJECT_ROOT, "out", "reports"), name, page.html, page.height);
      const image = path.relative(PROJECT_ROOT, files.pngFile);
      const imageMarkdown = selectionImageMarkdown(image);
      return {
        image,
        imageMarkdown,
        html: path.relative(PROJECT_ROOT, files.htmlFile),
        next: BOARD_REPLY,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: message, next: "截图没做成。四块文字照常写，不要声称已经有图。" };
    }
  },
});
