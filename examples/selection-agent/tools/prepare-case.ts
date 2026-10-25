import { defineTool } from "@typescript-agent-harness/cli";
import { loadPreparedCase } from "../lib/prepare.ts";

/** 选品之后、登录后台之前：报价单、试样清单、链接草稿。不填工厂数字。 */
export default defineTool({
  description:
    "读当前选品档案，以及已经记下的报价、试样结果和链接确认。没记下的保持空，不要补。链接文案只能复述档案里已有的结构。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    const prepared = loadPreparedCase();
    return {
      ...prepared,
      next: "没记下的报价和试样保持空，不能据此算利润，也不能把目标价写成已上架售价。不要打开浏览器。先把结论、排行榜、说明、缺口写给用户。写完按 select-to-shelf 用 ask_user 问报价、试样、链接确认、上架哪一条、要不要询盘。上架题的选项是排行榜前 4 名的商品标题，放弃的也要列上。询盘选了就调用 save_inquiry，不要用散文再问。",
    };
  },
});
