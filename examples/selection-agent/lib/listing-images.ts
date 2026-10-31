import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = path.resolve(import.meta.dirname, "../seller-backend/images.json");
const HOST = /^https:\/\/(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\//;

/** 搜索页主图，key 是 ASIN。读不到文件就返回空表，格子里显示 —。 */
export function loadListingImages(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
    const images: Record<string, string> = {};
    for (const [id, url] of Object.entries(raw)) {
      if (typeof url === "string" && HOST.test(url)) images[id] = url;
    }
    return images;
  } catch {
    return {};
  }
}
