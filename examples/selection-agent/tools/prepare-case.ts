import { defineTool } from "@typescript-agent-harness/cli";
import { BOARD_REPLY, boardShotOfLatest } from "../lib/board-shot.ts";
import { marketplaceProfile, sessionMarketplace } from "../lib/marketplace.ts";
import { loadPreparedCase } from "../lib/prepare.ts";

/** 选品之后、登录后台之前：报价单、试样清单、链接草稿。不填工厂数字。 */
export default defineTool({
  description:
    "读当前选品档案，以及已经记下的报价、试样结果和链接确认。没记下的保持空，不要补。链接文案只能复述档案里已有的结构。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    const prepared = loadPreparedCase();
    const market = sessionMarketplace();
    const profile = market ? marketplaceProfile(market) : null;
    const recorded = prepared.quote.status === "已报价" && prepared.sample.status === "已记录";
    const shot = boardShotOfLatest();
    const siteHint = profile
      ? `当前站点 ${profile.askLabel}（${profile.siteLabel}），货币 ${profile.currency}，发布按钮是「${profile.publishLabel}」。`
      : "还没选站点时，先 set_marketplace。";
    const next = recorded
      ? `${siteHint}报价和试样 1–6 已经记下。不要写「不是真实报价」或「还没试样」。这一轮只调用 ask_user，不要写结论、排行榜、说明、缺口，也不要调用 select_listing 或 browser_open。问题是「上架哪一条到模拟店？」，选项是排行榜前 4 名的商品标题，再加「先不上架」。等用户点了提交、ask_user 返回之后的下一轮再写四块。${BOARD_REPLY}点了商品标题，就在同一轮做 select_listing，并立刻 browser_open，url 必须是 http://127.0.0.1:7455/。点了「先不上架」或跳过，补一句「未上架」，不要打开浏览器。`
      : `${siteHint}没记下的报价和试样保持空，不能据此算利润，也不能把目标价写成已上架售价。这一轮只调用 ask_user，不要写结论，也不要调用 select_listing 或 browser_open。按 select-to-shelf 问报价、试样、链接确认、上架哪一条、要不要询盘。上架题的选项是排行榜前 4 名的商品标题，放弃的也要列上。等用户点了提交之后的下一轮再写四块。${BOARD_REPLY}点了商品标题且没有选「我下一条消息…」，同一轮 select_listing 后 browser_open，url 必须是 http://127.0.0.1:7455/。询盘选了就调用 save_inquiry，不要用散文再问。点了「先不上架」或跳过就不要打开浏览器。`;
    return {
      ...prepared,
      ...(profile
        ? {
            marketplace: profile.marketplace,
            currency: profile.currency,
            siteLabel: profile.siteLabel,
            publishLabel: profile.publishLabel,
          }
        : { marketplace: null }),
      ...shot,
      next,
    };
  },
});
