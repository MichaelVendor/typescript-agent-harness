# daily-worklog-agent — 夜间工作日志→日卡

约定式样板：每晚 23:00 采集当天 git / Cursor / 浏览器活动 → 合成 bundle → 模型写摘要 → 落盘本地日卡 `out/daily/YYYY-MM-DD.{md,json}`。

**不做**键鼠录制、全盘监控、对外发送；仅采集 `tah.worklog.json` 授权范围内的数据。摘要只依据 bundle，含 bundle 外 URL / commit hash 时 `save_day_card` 拒绝。

## 黄金路径

`collect_git` / `collect_cursor` / `collect_browser` → `compose_bundle` → 摘要 → `save_day_card` → 回复（摘要 · 日卡路径 · 缺口）。

日卡固定块：摘要 · Git · Cursor · 浏览器 · 缺口。某源缺失或为空进 `gaps`。

## 跑起来

在仓库根目录：

```bash
pnpm install
```

在本目录：

```bash
pnpm smoke      # fixture bundle → 确定性摘要 → 落盘（不起模型、不读真浏览器）
pnpm eval       # 无模型评测
pnpm test
pnpm typecheck
pnpm start      # tah chat（可加 --mock）
```

冒烟打印 `ok …/out/daily/<date>.md`；评测打印 `eval ok`。

## 真跑（需要 API key）

```bash
cp tah.worklog.json.example tah.worklog.json   # 改 repos / 域名白名单
# 在本目录 .env 或环境变量里设 DEEPSEEK_API_KEY 或 OPENAI_API_KEY
pnpm run-daily                                 # 可加 --date YYYY-MM-DD --config <path>
```

`run-daily`：采集 → `out/bundles/<date>.json` → 无 key 则 exit 1 → `tah run --quiet`（stdout 即摘要）→ 本地 `saveDayCard`。

浏览器历史通过 `sqlite3` CLI 读取 History 副本，仅保留白名单域名；读不到记为 gap。

## 定时（macOS launchd）

```bash
cp deploy/launchd/com.tah.daily-worklog.plist.example ~/Library/LaunchAgents/com.tah.daily-worklog.plist
# 编辑里面的 pnpm 与 WorkingDirectory 绝对路径（Hour=23）
launchctl load ~/Library/LaunchAgents/com.tah.daily-worklog.plist
```

## 铁律摘要

1. 工具出结构，模型只写摘要；不编造。
2. 缺源 / 空源 → `gaps`。
3. 只落盘日卡。
4. 回复：摘要 · 日卡路径 · 缺口。

## 结构

```
AGENTS.md                  铁律、路由
skills/nightly-day-card/   collect → compose → 摘要 → save
tools/                     collect_git / collect_cursor / collect_browser / compose_bundle / save_day_card
lib/                       schema、采集、合成、渲染、落盘
scripts/                   run-daily（夜间入口）、smoke
eval/                      无模型评测
deploy/launchd/            23:00 定时示例
data/fixtures/             虚构 bundle
```
