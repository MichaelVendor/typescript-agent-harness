# brief-agent：补 live 评论摘录

状态：已实现。  
选定：**C** — 先 `/product-reviews/{asin}`，仍空再 Playwright 滚 `/dp` 评论区。

## 流程

1. 现有 `/dp` 补 bullets（及页内能抽到的 reviews）  
2. curl `…/product-reviews/{asin}` → `parseDeDpReviews`  
3. 仍空且浏览器开：Chrome 开评论页；再不行开 `/dp` 滚到 review 再 content  
4. 合并进 ProductPage；仍空走 gaps

## 非目标

多站点、改 polarity 词表主逻辑。
