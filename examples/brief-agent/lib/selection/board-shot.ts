import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { boardCaption, boardPage, type BoardRow } from "./board-page.ts";
import { loadListingImages } from "./listing-images.ts";
import { marketplaceProfile, sessionMarketplace } from "./marketplace.ts";
import { PROJECT_ROOT } from "./report.ts";

const CHROME = [
  process.env.SELECTION_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "google-chrome",
  "chromium",
].filter((item): item is string => Boolean(item));

function chromePath(): string | undefined {
  return CHROME.find((file) => file.includes("/") ? existsSync(file) : true);
}

/** 把 HTML 写成同目录的 png。用本机 Chrome 截整页视口。 */
export function screenshotHtml(htmlFile: string, pngFile: string, height: number): void {
  const chrome = chromePath();
  if (!chrome) throw new Error("找不到 Chrome，无法把选品页截成图片");
  mkdirSync(path.dirname(pngFile), { recursive: true });
  const result = spawnSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      `--window-size=880,${height}`,
      "--virtual-time-budget=8000",
      `--screenshot=${pngFile}`,
      pathToFileURL(htmlFile).href,
    ],
    { timeout: 30_000 },
  );
  if (result.status !== 0 || !existsSync(pngFile)) {
    const detail = [result.stderr?.toString().trim(), result.stdout?.toString().trim(), result.error?.message, result.signal ? `signal ${result.signal}` : ""]
      .filter(Boolean)
      .join("\n") || "截图失败";
    throw new Error(detail);
  }
}

export function selectionImageMarkdown(file: string): string {
  return `![选品结果](${file})`;
}

/** 回复第一行必须贴这张图。工具的 next 原样带上这句。 */
export const BOARD_REPLY =
  "回复的第一行必须原样复制 imageMarkdown，不要改路径，不要换成网址，不要只出文字表。然后再写结论、排行榜、说明、缺口。";

/** 用这份报告的分数画看板，png 和 json 放在同一目录、同一时间戳。 */
export function renderReportBoard(
  rows: BoardRow[],
  jsonFile: string,
  root: string = PROJECT_ROOT,
): { image: string; imageMarkdown: string } {
  const market = sessionMarketplace();
  const page = boardPage({
    conclusion: boardCaption(rows),
    rows,
    images: loadListingImages(),
    ...(market ? { siteLabel: marketplaceProfile(market).siteLabel } : {}),
  });
  const files = writeBoardFiles(path.dirname(jsonFile), path.basename(jsonFile, ".json"), page.html, page.height);
  const image = path.relative(root, files.pngFile);
  return { image, imageMarkdown: selectionImageMarkdown(image) };
}

/** 截图失败时报告仍然算落盘成功。 */
export function renderReportBoardSafe(
  rows: BoardRow[],
  jsonFile: string,
  root: string = PROJECT_ROOT,
): { image: string; imageMarkdown: string } | { imageError: string } {
  try {
    return renderReportBoard(rows, jsonFile, root);
  } catch (error) {
    return { imageError: error instanceof Error ? error.message : String(error) };
  }
}

/** 最近一份报告的看板。已经有 png 就直接用，没有就现截。失败不抛，交给调用方继续。 */
export function boardShotOfLatest(root: string = PROJECT_ROOT): { image: string; imageMarkdown: string } | { imageError: string } {
  try {
    const dir = path.join(root, "out", "reports");
    const name = readdirSync(dir).filter((file) => file.endsWith(".json")).sort().at(-1);
    if (!name) return { imageError: "还没有选品报告" };
    const jsonFile = path.join(dir, name);
    const pngFile = jsonFile.replace(/\.json$/, ".png");
    if (existsSync(pngFile)) {
      const image = path.relative(root, pngFile);
      return { image, imageMarkdown: selectionImageMarkdown(image) };
    }
    const report = JSON.parse(readFileSync(jsonFile, "utf8")) as { rows?: BoardRow[] };
    if (!report.rows?.length) return { imageError: "最近一份报告没有排行" };
    return renderReportBoard(report.rows, jsonFile, root);
  } catch (error) {
    return { imageError: error instanceof Error ? error.message : String(error) };
  }
}

export function writeBoardFiles(dir: string, name: string, html: string, height: number): { htmlFile: string; pngFile: string } {
  mkdirSync(dir, { recursive: true });
  const htmlFile = path.join(dir, `${name}.html`);
  const pngFile = path.join(dir, `${name}.png`);
  writeFileSync(htmlFile, html, "utf8");
  screenshotHtml(htmlFile, pngFile, height);
  return { htmlFile, pngFile };
}
