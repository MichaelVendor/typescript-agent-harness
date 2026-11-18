import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import http from "node:http";

const mode = process.env.FAKE_MODE ?? "ok";
const args = process.argv.slice(2);
const cwdIdx = args.indexOf("--cwd");
const cwd = cwdIdx >= 0 ? args[cwdIdx + 1] : process.cwd();

if (args[0] === "channel-host") {
  console.log(`[tah] channel-host persist → ${cwd}/.tah/super-agent`);
  console.log("[tah] Ctrl+C to stop");
  if (mode === "channel-exit") {
    console.error("channel-host boom");
    process.exit(1);
  }
  process.on("SIGINT", () => process.exit(0));
  setInterval(() => {}, 60_000);
} else if (mode === "exit") {
  console.error("boom: no model configured");
  process.exit(1);
} else if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  if (mode === "family") {
    const grandchild = spawn("sleep", ["30"], { stdio: "ignore" });
    writeFileSync(process.env.FAKE_PIDFILE, String(grandchild.pid));
    console.log(`[fake] grandchild ${grandchild.pid}`);
  }
  const token = "secret";
  const panel = args.includes("--super-agent-panel")
    ? args[args.indexOf("--super-agent-panel") + 1]
    : "";
  if (panel) console.error(`[fake] panel=${panel}`);
  const server = http.createServer((req, res) => {
    const { port } = server.address();
    if (req.url !== "/api/workspaces" || req.headers.cookie !== `tah_token_${port}=${token}`) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ path: "/elsewhere", active: false }, { path: cwd, active: true }]));
  });
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    console.log(`[tah] serving ${cwd} — Ctrl+C to stop`);
    console.log(`[tah] open http://127.0.0.1:${port}/?token=${token}`);
    if (mode === "crash") {
      setTimeout(() => {
        console.error("crashed hard");
        process.exit(3);
      }, 100);
    }
  });
  process.on("SIGINT", () => {
    if (mode === "stubborn" || mode === "family") return;
    console.log("[tah] stopping…");
    server.close();
    process.exit(0);
  });
}
