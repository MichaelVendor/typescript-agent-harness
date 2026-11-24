# meeting-actions-agent — 纪要→行动项

约定式样板：会议转写/纪要 → 结构化行动项，缺负责人须确认后再落盘 `out/actions/`。

**不做**自动发消息、真日历写入。负责人只来自原文或可核对的用户确认。

## 跑起来

在仓库根目录：

```bash
pnpm install
```

在本目录：

```bash
pnpm smoke    # 不起模型跑完整链路并落盘
pnpm eval     # 无模型黄金路径
pnpm test
pnpm typecheck
pnpm start    # tah chat（可加 --mock）
```

冒烟打印 `ok …/out/actions/<时间戳>.md`。

## 结构

```
AGENTS.md                 铁律、路由、回复四块
skills/meeting-to-actions/  extract → compose → confirm → save
tools/                    extract_actions / compose_draft / confirm_actions / save_actions
lib/                      schema、抽取、合成、落盘
data/fixtures/            虚构中文转写
```

内置 `ask_user` 由 tah 提供；本项目 `tools/` 不重复定义。