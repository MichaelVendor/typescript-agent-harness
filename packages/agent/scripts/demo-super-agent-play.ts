/**
 * 可玩 Super-agent demo：真跑编排，固定写到 out/super-agent/play，给侧栏「工单」看。
 *
 *   node --experimental-strip-types packages/agent/scripts/demo-super-agent-play.ts --auto
 *   node --experimental-strip-types packages/agent/scripts/demo-super-agent-play.ts
 *
 * 另开网页：
 *   node packages/cli/dist/cli.js serve --mock --no-exec --port 7420 \
 *     --super-agent-panel out/super-agent/play --cwd packages/agent
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSuperAgent,
  type RouterAction,
  type WorkerReport,
} from "../src/super-agent.ts";
import { createMockGitHubSource } from "../src/super-agent-source.ts";

const auto = process.argv.includes("--auto");
const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const persistDir = path.join(root, "out", "super-agent", "play");
const pauseMs = Number(process.env.PLAY_MS ?? (auto ? 4000 : 0));

type Mode = "open_pr" | "wait_review" | "apply_review" | "ask_merge";
let mode: Mode = "open_pr";

const gh = createMockGitHubSource();
const sa = createSuperAgent({
  id: "play-demo",
  persistDir,
  defaultMandate: { scope: "local play only", policyVersion: "play" },
  async routerDecide({ event }): Promise<RouterAction> {
    if (event.kind === "user_message") {
      return { type: "spawn_ticket", goal: event.text, threadId: "github:pr/play" };
    }
    if (event.kind === "worker_report") {
      if (mode === "ask_merge") {
        return { type: "ask_human", text: "PR 已改好，是否合并到 main？" };
      }
      return { type: "reply", text: `DONE：${event.text}` };
    }
    return { type: "reply", text: "ok" };
  },
  async workerRun({ mailbox }): Promise<WorkerReport> {
    if (mode === "wait_review") {
      return { text: "PR 草稿已开，等 review…", done: false };
    }
    if (mode === "apply_review" || mailbox.some((e) => e.kind === "source_event")) {
      return { text: "已按评论补上单测", done: true };
    }
    if (mode === "ask_merge") {
      return { text: "合并前检查通过", done: true };
    }
    return { text: "已开 PR（play）", done: true };
  },
});

async function drain(max = 10): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const out = await sa.step();
    if (!out) break;
    console.log(`  → [${out.phase}]`, JSON.stringify(out.detail).slice(0, 140));
  }
}

function showPanel(): void {
  const p = sa.reviewPanel();
  console.log(
    `\n  [panel] status=${p.status}  running=${p.running.map((t) => t.goal).join(" | ") || "—"}  needsHuman=${p.needsHuman.map((t) => t.goal).join(" | ") || "—"}`,
  );
  console.log(`  最近回复: ${JSON.stringify(p.recentReplies.slice(-2))}`);
  console.log(`  👉 看浏览器右侧「工单」（约 3 秒刷新）\n`);
}

async function pause(title: string): Promise<void> {
  console.log(`\n══ ${title} ══`);
  showPanel();
  if (auto) {
    await new Promise((r) => setTimeout(r, pauseMs));
    return;
  }
  const rl = createInterface({ input, output });
  await rl.question("按回车继续… ");
  rl.close();
}

console.log("Super-agent PLAY");
console.log(`persist = ${persistDir}`);
console.log(`mode    = ${auto ? `auto ${pauseMs}ms/步` : "interactive（回车推进）"}`);
console.log("");

await pause("准备就绪 — 打开 serve 后看右侧「工单」");

mode = "wait_review";
sa.ingest({ kind: "user_message", text: "修登录空指针并开 PR", channel: "play" });
await drain(2);
await pause("① Router 已派工，Worker running（等 GitHub 评论）");

mode = "apply_review";
sa.ingest(
  gh.toSourceEvent({
    threadId: "github:pr/play",
    body: "请补单测",
    author: "reviewer",
    kind: "pull_request",
  }),
);
await drain();
await pause("② 评论直达 Worker → done → Router 对外 DONE");

mode = "ask_merge";
sa.ingest({ kind: "user_message", text: "准备合并到 main", channel: "play" });
await drain();
await pause("③ 第二单跑完 → Router ask_human（侧栏待人审）");

console.log("玩完了。");
console.log(`  tickets: ${sa.tickets().map((t) => `${t.status}:${t.goal}`).join(" | ")}`);
console.log("  再玩：重新跑本脚本；聊天框不会驱动 Super-agent。");
showPanel();
