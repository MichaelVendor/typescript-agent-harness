import { moneySign, recommendFromDisk, type RecommendedQuery } from "./lib/recommend.ts";

function short(title: string): string {
  const text = title.replace(/\s+/g, " ").trim();
  return text.length > 24 ? `${text.slice(0, 23)}…` : text;
}

function siteTag(askLabel: string): string {
  return askLabel === "美国站" ? "美" : "德";
}

/** 按搜索词轮询商品，未选站时德/美交错，避免德站 3 条先占满。 */
function pickChips(items: RecommendedQuery[], limit: number) {
  const queues = items.map((item) => ({ item, products: [...item.products] }));
  const out: { label: string; send: string; detail: string }[] = [];
  while (out.length < limit && queues.some((q) => q.products.length > 0)) {
    for (const q of queues) {
      if (out.length >= limit) break;
      const product = q.products.shift();
      if (!product) continue;
      const tag = siteTag(q.item.askLabel);
      out.push({
        label: `${tag} · ${short(product.title)}  ${moneySign(q.item.currency)}${product.priceEur.toFixed(2)}`,
        send: q.item.send,
        detail: `${q.item.askLabel} · ${q.item.query} · ${q.item.action}`,
      });
    }
  }
  return out;
}

/** 网页输入框上方的可点推荐。未选站时德/美都出；已选站只出该站。点一下发出「站点 + 搜索词」。 */
export default function suggestions(cwd: string): { label: string; send: string; detail: string }[] {
  return pickChips(recommendFromDisk(cwd), 4);
}
