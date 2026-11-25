# Daily Worklog Agent（夜间工作日志→日卡）设计

状态：✅ 已实现

定位：个人工作记忆的 **采集 + 夜间整理** 样板；产出仅本地日卡，为后续「分身」留数据，本阶段不做分身对话。

## 背景

用户每日工作几乎都在 **浏览器、Cursor、git**。需要每晚自动汇总，而不是全盘监控。

本样板：授权范围内采集三源 → 必跑 LLM 整理 → 落盘日卡。对齐 tah「工具出结构、不编造」；定时用本机 `launchd`，不改 Runtime。

## 目标

1. `examples/daily-worklog-agent`：约定式项目，可抄目录。
2. 标准路径：23:00（或 `pnpm run-daily`）→ 采 git / Cursor / 浏览器 → bundle → LLM 日卡 → `out/daily/YYYY-MM-DD.{md,json}`。
3. `pnpm smoke` / `eval` 用 fixture，不读真浏览器 History；真跑需 API key。
4. 日卡固定块：摘要 · Git · Cursor · 浏览器 · 缺口。

## 非目标

- 改 `packages/*`。
- 键鼠录制、全盘/全屏监控、隐蔽采集。
- 桌宠 / 数字人壳、系统通知、自动更新「分身画像」。
- 无人值守对外发邮件/IM/发 PR。

## 方案

**约定式单项目（已选）**：`AGENTS.md` + skill `nightly-day-card` + collect/compose/save tools + `scripts/run-daily.ts` + launchd 示例。

不选：纯 shell 与 Agent 分离（难抄）；绑死 `apps/desktop`（耦合产品壳）。

## 目录

```
examples/daily-worklog-agent/
├── AGENTS.md
├── tah.config.json
├── tah.worklog.json.example
├── package.json
├── tsconfig.json
├── skills/nightly-day-card/SKILL.md
├── tools/
│   ├── collect-git.ts
│   ├── collect-cursor.ts
│   ├── collect-browser.ts
│   ├── compose-bundle.ts
│   └── save-day-card.ts
├── lib/
├── data/fixtures/
├── scripts/run-daily.ts
├── deploy/launchd/com.tah.daily-worklog.plist.example
├── eval/
└── README.md
```

## 铁律（AGENTS.md）

1. 日卡每条事实必须能指回 bundle 中的 commit / URL / Cursor evidence；禁止编造。
2. 某源失败或未配置 → 写入 `gaps`，仍可对其余源出卡。
3. 浏览器仅 `domainAllowlist`；History 用只读副本，不上传第三方（用户自己的 LLM API 除外）。
4. `save_day_card` 不向模型暴露任意 `outDir`；输出固定在项目 `out/daily/`。

## 流程

```
读 tah.worklog.json
  → collect_git
  → collect_cursor
  → collect_browser
  → compose_bundle → out/bundles/<date>.json
  → skill / tah run：LLM 归纳日卡（无 key → 非 0 退出并写 log）
  → save_day_card → out/daily/<date>.{md,json}
```

定时：`deploy/launchd/com.tah.daily-worklog.plist.example`，`StartCalendarInterval` **Hour=23**（本地时区）；手册亦可 `pnpm run-daily`。

## 配置

`tah.worklog.json`（由 example 复制）：

```json
{
  "repos": ["~/Desktop/AgentHarness"],
  "cursor": { "projectsRoot": "~/.cursor/projects" },
  "browser": {
    "historyDb": "auto",
    "domainAllowlist": ["github.com", "localhost"]
  },
  "timezone": "Asia/Shanghai"
}
```

## 数据

`compose_bundle` 产出：

```ts
{
  date: string; // YYYY-MM-DD in configured timezone
  git: Array<{
    repo: string;
    commits: Array<{ hash: string; subject: string; files?: string[] }>;
  }>;
  cursor: Array<{ workspace: string; note: string; evidence: string }>;
  browser: Array<{ url: string; title: string; visitTime?: string }>;
  gaps: string[];
}
```

- **git：** 各 repo 当日 00:00–24:00（配置时区）的 commits。  
- **cursor：** 扫描 `projectsRoot` 下今日有活动的工作区/transcript 摘要；不可读则 gap。  
- **browser：** Chromium 系 History（`auto` 探测 Chrome/Arc/Edge 等）；仅 allowlist 域名。

## 工具职责

| 工具 | 职责 |
| --- | --- |
| `collect_git` | 按配置 repos 拉当日 commits |
| `collect_cursor` | 拉 Cursor 侧可解析摘要 |
| `collect_browser` | 只读 History 副本 + 域名过滤 |
| `compose_bundle` | 合并三源 + gaps |
| `save_day_card` | 校验后落盘 md/json |

Skill `nightly-day-card`：在 bundle 齐后调用模型归纳，再 `save_day_card`。`run-daily` 可非交互编排 collect→compose→（LLM）→save。

## 脚本与验收

| 命令 | 行为 |
| --- | --- |
| `pnpm start` | `tah chat`（调试） |
| `pnpm run-daily` | 真采集 + 真 LLM → 日卡；缺 key 失败 |
| `pnpm smoke` | fixture → save（可 mock 摘要），打印 `ok …/out/daily/…` |
| `pnpm eval` | 日卡无 fixture 外 hash/URL；缺源时 gaps 非空 |
| `pnpm test` | schema / 域名过滤 / git 日期窗 |

## 文档

- `README.md`：配置、权限（浏览器 History）、launchd 安装、与「分身」后续关系一句。
- 可选：getting-started 专家样板链追加 daily-worklog（注明需本机权限）。

## 后续

用户批准本文 → `writing-plans` → 实现。分身检索日卡、桌宠入口为独立 spec。
