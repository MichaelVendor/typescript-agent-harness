# brief-agent P1-E：差评主题清洗（正负分离）

状态：P1-E 已实现。  
选定：**A** — `extractSignals` 规则词典拆正负；无模型。

## 目标

「差评主题」只出负面/风险向；正面进「好评要点」。避免 mock/live 摘录里好评混进差评栏。

## 非目标

- 不做 LLM 情感分析、不做多语言 ML
- 不改 fetch / save / tasks
- 不要求 DE 词典完备（可迭代加词）

## 规则

`lib/signals.ts`（或小文件 `lib/review-polarity.ts`）：

1. 对每条 `reviewSnippets` trim 后，大小写无关匹配：
   - **负**：命中 neg 词表 → `cons`
   - **正**：命中 pos 词表、且未命中 neg → `pros`（neg 优先）
   - **其余**：中性，两边都不进（不写缺口，保持简报干净）
2. 同桶内大小写无关去重，保留首次写法。
3. 词表起步（DE/EN，可后续加）：
   - neg：`rost|rust|schwer|klein|kratzt|scratch|geruch|smell|weicht|abweich|kaputt|broken|schlecht|poor|defect|mangel`
   - pos：`schön|gut|edel|stabil|leicht|preis|good|great|solid|nice|quality|verarbeitet`

匹配：子串即可（snippet 短）；词表用 `|` 拼正则，单词边界可选——snippet 多为短语，**子串**足够。

## Schema

`SignalBucket.reviews`：

- `themes`：**仅 cons**（兼容现有 compose / diff「差评主题」）
- 新增 `pros: string[]`

`BriefRow`：

- `reviewThemes`：仍 = cons
- 新增可选 `reviewPros?: string[]`（compose 写入）

旧 brief JSON 无 `reviewPros` 时 diff 只比 `reviewThemes`。

## Compose（ops）

- `### 差评主题`：只 `reviewThemes`（逻辑不变）
- 新增 `### 好评要点`：有任一 `reviewPros` 才渲染；否则省略整节（避免空栏目）
- `exec`：仍不输出差评/好评全文（一页纸不变）

## 评测 / 单测

- `signals.test.ts`：B001 snippets → pros 含「schön…」，不含进 themes；B002「Rost…」进 themes
- 可选 eval `review-polarity`：happy 路径 markdown 含「差评主题」且不含把「guter Preis」当差评（或 assert themes 不含该串）
- 既有 eval 仍绿（themes 变短可接受；assert 若绑死全文需微调）

## 文档

README / AGENTS 一句；父设计 P1-E ✅。

## 验收

`pnpm test` + `pnpm eval` + `pnpm typecheck` 绿。
