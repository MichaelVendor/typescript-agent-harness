# weekly-report-agent — 杂记→周报

约定式样板：本周杂记 → 归类（完成 / 进行中 / 风险 / 下周）→ 人选模板（`ops` 细表 / `exec` 一页纸）→ 落盘 `out/reports/`。

**不做**读 git log / 日历 / IM、自动发周报。正文只来自原文，不编造事项、数字、人名。

## 黄金路径

`extract_items` → `compose_draft` → 内置 `ask_user` 选 `ops` / `exec` → `render_report` → `save_report` → 回复三块（摘要 · 正文 · 缺口）。

## 跑起来

在仓库根目录：

```bash
pnpm install
```

在本目录：

```bash
pnpm smoke    # 不起模型跑完整链路并落盘（注入 ops）
pnpm eval     # 无模型黄金路径
pnpm test
pnpm typecheck
pnpm start    # tah chat（可加 --mock）
```

冒烟打印 `ok …/out/reports/<时间戳>.md`；评测打印 `eval ok`。

## 铁律摘要

1. 工具出结构，模型只润色；不编造。
2. 无法归类 → `unclassified` + `gaps`，不进正文主表。
3. 先选 `ops` | `exec`，再 `save_report`。
4. 回复三块：摘要 · 周报正文 · 缺口。

## 结构

```
AGENTS.md                  铁律、路由
skills/notes-to-weekly/    extract → compose → ask_user → render → save
tools/                     extract_items / compose_draft / render_report / save_report
lib/                       schema、抽取、合成、渲染、落盘
data/fixtures/             虚构中文杂记
```

内置 `ask_user` 由 tah 提供；本项目 `tools/` 不重复定义。
