# brief-agent P1-C：简报模板 ops|exec

状态：P1-C 已实现。  
`composeBrief` / `compose_brief` 增加 `template?: "ops" | "exec"`，默认 `ops`。  
`exec`：结论 + 对照（≤3 行，无卖点列）+ 要事（变更前 3 条）；无差评/缺口全文。

评测：`template-exec`；ops 回归绿。
