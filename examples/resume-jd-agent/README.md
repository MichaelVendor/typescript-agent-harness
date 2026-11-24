# resume-jd-agent — 简历×JD 匹配

约定式样板：简历 + JD → 解析 → 逐条匹配（满足 / 部分满足 / 缺失，带简历原文证据）→ 人选是否生成改写建议 → 落盘 `out/match/`。

**不做**真投递、LinkedIn / ATS 接入、封面信。不编造简历里没有的经历、技能或数字。

## 黄金路径

`parse_pair` → `match_requirements` → 内置 `ask_user` 选是否改写 → （yes）`compose_rewrites` → `save_report` → 回复四块（匹配摘要 · 匹配表 · 改写 · 缺口）。

## 跑起来

在仓库根目录：

```bash
pnpm install
```

在本目录：

```bash
pnpm smoke    # 不起模型跑完整链路并落盘（注入 includeRewrites=true）
pnpm eval     # 无模型黄金路径
pnpm test
pnpm typecheck
pnpm start    # tah chat（可加 --mock）
```

冒烟打印 `ok …/out/match/<时间戳>.md`；评测打印 `eval ok`。

## 输入格式

```
===简历===
- 一条经历一行，以「- 」开头

===JD===
【必须】……
【加分】……
```

## 铁律摘要

1. 工具出结构，模型只润色；不编造。
2. met / partial 必带简历证据；无证据只能 missing + gaps，不生成改写。
3. 先确认是否改写（yes / no），再 `save_report`；工具不暴露 `outDir`。
4. 回复四块：匹配摘要 · 匹配表 · 改写（可选）· 缺口。

## 结构

```
AGENTS.md                  铁律、路由
skills/resume-jd-match/    parse → match → ask_user → rewrites → save
tools/                     parse_pair / match_requirements / compose_rewrites / save_report
lib/                       schema、解析、匹配、改写、渲染、落盘
data/fixtures/             虚构中文简历 + JD
```

内置 `ask_user` 由 tah 提供；本项目 `tools/` 不重复定义。
