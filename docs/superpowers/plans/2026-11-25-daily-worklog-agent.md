# Daily Worklog Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `examples/daily-worklog-agent`：采集 git/Cursor/浏览器 → bundle → LLM 日卡 → `out/daily/`；23:00 launchd 示例；smoke/eval 用 fixture。

**Architecture:** 采集与校验在 `lib/`；`tools/*.ts` 为 `defineTool` 薄包装。`scripts/run-daily.ts` 编排 collect→compose→（`tah run` 或内嵌归纳入口）→save。smoke 不读真 History、可用注入摘要跳过真 LLM。

**Tech Stack:** TypeScript、`better-sqlite3` 或 Node 读 SQLite 只读副本（浏览器 History）、`child_process` git、`@typescript-agent-harness/cli`、`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-25-daily-worklog-agent-design.md`

## Global Constraints

- 不改 `packages/*`
- 仅 `examples/daily-worklog-agent/**`（可选 getting-started 一句）
- 日卡事实必须能指回 bundle；浏览器仅 domainAllowlist；History 只读副本
- `save_day_card` 不向模型暴露任意 `outDir`
- smoke/eval 不依赖真 History / 真 LLM key（run-daily 需要 key）
- Conventional Commits；不 push（除非用户另说）

## File map

| File | Role |
| --- | --- |
| `lib/schema.ts` | WorklogConfig、DayBundle、DayCard、validate* |
| `lib/config.ts` | 加载 `tah.worklog.json`，expand `~` |
| `lib/collect-git.ts` | git log 当日窗 |
| `lib/collect-cursor.ts` | 扫描 projectsRoot |
| `lib/collect-browser.ts` | History 副本 + 域名过滤 |
| `lib/compose.ts` | 合并三源 |
| `lib/render.ts` | bundle + summary → markdown |
| `lib/save.ts` | 落盘 bundles/ + daily/ |
| `lib/summarize.ts` | 规则摘要（smoke）或调用点给 LLM 结果 |
| `tools/*.ts` | defineTool |
| `skills/nightly-day-card/SKILL.md` | 流程 |
| `scripts/run-daily.ts` | 夜间编排 |
| `deploy/launchd/*.plist.example` | Hour=23 |
| `data/fixtures/*` | 假 bundle / 假 History sqlite（可选最小） |

---

### Task 1: Scaffold + schema + config + fixture

**Files:**
- Create: `examples/daily-worklog-agent/package.json`, `tsconfig.json`, `tah.config.json`, `.gitignore`
- Create: `tah.worklog.json.example`
- Create: `lib/schema.ts`, `lib/schema.test.ts`, `lib/config.ts`, `lib/config.test.ts`
- Create: `data/fixtures/bundle-sample.json`

**Interfaces:**
- `WorklogConfig`, `DayBundle`, `DayCard`
- `validateDayBundle(b): string[]` — date 格式；browser URL 若存在须非空
- `loadWorklogConfig(path): WorklogConfig` — 缺文件 throw；`~` expand

- [ ] **Step 1: Failing schema/config tests**

```ts
// lib/schema.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateDayBundle } from "./schema.ts";

test("accepts minimal bundle with gaps", () => {
  assert.equal(validateDayBundle({
    date: "2026-11-25",
    git: [],
    cursor: [],
    browser: [],
    gaps: ["browser: not configured"],
  }).length, 0);
});

test("rejects bad date", () => {
  assert.ok(validateDayBundle({
    date: "25-11-2026",
    git: [], cursor: [], browser: [], gaps: [],
  }).some((p) => /date/i.test(p)));
});
```

```ts
// lib/config.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorklogConfig } from "./config.ts";

test("expands tilde in repos", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "worklog-cfg-"));
  try {
    const p = path.join(dir, "tah.worklog.json");
    writeFileSync(p, JSON.stringify({
      repos: ["~/Desktop/AgentHarness"],
      cursor: { projectsRoot: "~/.cursor/projects" },
      browser: { historyDb: "auto", domainAllowlist: ["github.com"] },
      timezone: "Asia/Shanghai",
    }));
    const c = loadWorklogConfig(p);
    assert.ok(!c.repos[0]!.startsWith("~"));
    assert.equal(c.timezone, "Asia/Shanghai");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Implement schema + config + package scaffold**（version `1.7.5`，scripts 含 `run-daily` / `smoke` / `eval` / `test` / `typecheck` / `start`）

Fixture `data/fixtures/bundle-sample.json`：含 1 条 git commit（hash `abc1234`）、1 条 cursor、1 条 `https://github.com/foo`、1 条 gap。

- [ ] **Step 3: Tests PASS → Commit**

```bash
git add examples/daily-worklog-agent
git commit -m "$(cat <<'EOF'
feat(examples): daily-worklog scaffold 与 schema

EOF
)"
```

---

### Task 2: collect git + browser filter + cursor scan (lib) TDD

**Files:**
- Create: `lib/collect-git.ts`, `collect-git.test.ts`
- Create: `lib/collect-browser.ts`, `collect-browser.test.ts`（域名过滤纯函数 + 可选假 urls 列表，不必真 sqlite 也能测过滤）
- Create: `lib/collect-cursor.ts`, `collect-cursor.test.ts`（用临时目录假装 projectsRoot）

**Interfaces:**
- `collectGit(repos: string[], date: string, timezone: string): { git: DayBundle["git"]; gaps: string[] }`
- `filterBrowserUrls(rows, allowlist): rows` + `collectBrowser(opts): { browser; gaps }`
- `collectCursor(projectsRoot, date, timezone): { cursor; gaps }`

- [ ] **Step 1: Tests**

Git：对当前 AgentHarness repo 调 `collectGit`，`date` 用有 commit 的一天或接受空列表不 throw。

Browser filter：

```ts
test("domain allowlist keeps github drops others", () => {
  const rows = filterBrowserUrls([
    { url: "https://github.com/a", title: "a" },
    { url: "https://evil.example/x", title: "x" },
  ], ["github.com"]);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.url, /github/);
});
```

Cursor：临时 dir 写 `proj/agent-transcripts/x.jsonl` mtime 今天，assert 收集到 workspace 名；空根 → gap。

- [ ] **Step 2: Implement collectors**  
  - git: `git -C repo log --since=... --until=... --pretty=format:%H%x09%s`  
  - browser: 若 `historyDb==="auto"` 探测常见路径；文件不存在 → gap；若存在则 **copyFileSync 到 tmp** 再开 SQLite（`urls`/`visits`）；无原生绑定时可用 `execFileSync("sqlite3", ...)` 作为 MVP，避免强加 `better-sqlite3` 编译痛——**采用 `sqlite3` CLI 若存在，否则 gap `browser: sqlite3 cli missing`**（README 注明）。  
  - cursor: 列 `projectsRoot` 子目录，找 `agent-transcripts` 下今日 mtime 文件，note=文件名或首行截断，evidence=路径。

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(examples): daily-worklog 三源采集

EOF
)"
```

---

### Task 3: compose + render + save + summarize gate TDD

**Files:**
- Create: `lib/compose.ts`, `render.ts`, `save.ts`, `summarize.ts` + tests

**Interfaces:**
```ts
composeBundle(parts): DayBundle
renderDayCard(bundle: DayBundle, summary: string): { markdown: string }
/** smoke: 从 bundle 生成可指回证据的摘要，不调用 LLM */
summarizeFromBundle(bundle: DayBundle): string
saveBundle(bundle, opts?: { outDir?: string }): { jsonPath: string }
saveDayCard(bundle, summary, opts?: { outDir?: string }): { mdPath: string; jsonPath: string; markdown: string }
```

规则：
- `saveDayCard` 先 `validateDayBundle`；summary 中若出现 `https://` 或 7+ hex 且不在 bundle 内 → throw `validation failed`（简单扫描）或至少 eval 层断言；**MVP：eval 扫输出，save 校验 bundle。**
- 写出 `out/bundles/<date>.json`、`out/daily/<date>.{md,json}`。

- [ ] **Step 1–2: TDD implement → PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(examples): daily-worklog compose/render/save

EOF
)"
```

---

### Task 4: tools + skill + run-daily + launchd + smoke/eval + README

**Files:**
- Create: `tools/collect-*.ts`, `compose-bundle.ts`, `save-day-card.ts`
- Create: `skills/nightly-day-card/SKILL.md`, `AGENTS.md`, `README.md`
- Create: `scripts/run-daily.ts`, `scripts/smoke.ts`, `eval/run-eval.ts`
- Create: `deploy/launchd/com.tah.daily-worklog.plist.example`
- Modify (optional): `docs/guide/getting-started.md` 专家链一句
- Modify: design spec 状态 → ✅ 已实现

**run-daily 行为：**
1. load config（缺省 `./tah.worklog.json`）
2. collect 三源 → compose → `saveBundle`
3. 若无 `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` → exit 1，stderr 提示
4. 否则：`spawnSync`/`execFileSync` 调用 `tah run`（workspace 本 example），prompt 含 bundle JSON 路径与「只依据 bundle 写摘要，禁止编造」，捕获 stdout 为 summary；或读模型写入的约定文件——**采用：prompt 要求模型调用 `save_day_card`；run-daily 在 tah run 之后检查 `out/daily/<date>.md` 是否存在。**  
   若交互 tah run 对 cron 不友好：**采用 lib 路径**——`run-daily` 在有 key 时用 `@typescript-agent-harness/llm` 或 CLI `tah run --quiet` 一次性 prompt，把返回文本当 summary，再本地 `saveDayCard`。  
   **锁定：`tah run --quiet "<prompt with bundle path>"`，stdout=summary，再 `saveDayCard`。**

**smoke：** 读 fixture bundle → `summarizeFromBundle` → `saveDayCard` → print `ok …`

**eval：** fixture 日卡不含 `evil.example`；含 `abc1234` 与 github.com；人为缺 browser 的 bundle gaps 非空。

**launchd plist：** `ProgramArguments` 指向 `pnpm run-daily` 的绝对路径占位；`Hour=23`；`WorkingDirectory` 占位。

- [ ] **Step: install + verify**

```sh
cd examples/daily-worklog-agent && pnpm test && pnpm smoke && pnpm eval && pnpm typecheck
```

- [ ] **Commits**

```bash
git commit -m "$(cat <<'EOF'
feat(examples): daily-worklog 约定式夜间日卡样板

EOF
)"

git commit -m "$(cat <<'EOF'
docs: daily-worklog 已实现说明

EOF
)"
```

---

## Self-review (plan author)

1. **Spec coverage:** 三源、23:00、必 LLM（run-daily）、只落日卡、fixture smoke/eval、launchd、铁律 → Tasks 1–4。  
2. **Placeholders:** 无 TBD；browser SQLite 策略已定为 sqlite3 CLI + gap。  
3. **Types:** DayBundle / WorklogConfig 前后一致。
