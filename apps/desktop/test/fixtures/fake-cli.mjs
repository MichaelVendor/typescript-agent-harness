import http from "node:http";

const mode = process.env.FAKE_MODE ?? "ok";
const args = process.argv.slice(2);
const cwd = args[args.indexOf("--cwd") + 1];

if (mode === "exit") {
  console.error("boom: no model configured");
  process.exit(1);
}
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  const token = "secret";
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
    if (mode === "stubborn") return;
    console.log("[tah] stopping…");
    server.close();
    process.exit(0);
  });
}
