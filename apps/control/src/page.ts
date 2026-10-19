/** The control-plane chat page. The browser only talks to this app. */
export const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>tah</title>
<style>
  :root {
    --bg: #fff; --panel: #f6f7f9; --border: #e3e5e8; --text: #1f2328; --muted: #6b7280;
    --accent: #0e7490; --ok: #15803d; --warn: #b45309; --hover: #eceef1; --fail: #b91c1c;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif;
    font-size: 15px; line-height: 1.6; color: var(--text);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  button, input { font: inherit; color: var(--text); }
  button { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 4px 12px; cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.link { background: none; border: 0; color: var(--muted); padding: 0; }
  input { border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; background: #fff; }
  #login { min-height: 100%; display: grid; place-items: center; background: #e9ebef; }
  #login form { width: 320px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 10px; }
  #login h1 { margin: 0 0 6px; font-size: 18px; display: flex; align-items: center; gap: 8px; }
  .mark { width: 22px; height: 22px; border-radius: 6px; background: var(--accent); color: #fff; display: grid; place-items: center; font-size: 12px; }
  .err { color: var(--fail); font-size: 13px; min-height: 1.2em; }
  #app { display: none; height: 100%; }
  .window { height: 100%; display: flex; }
  .side { width: 260px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 8px; padding: 14px 14px 8px; font-weight: 700; }
  .who { position: relative; margin-top: auto; padding: 8px; }
  .user-menu { position: absolute; left: 8px; right: 8px; bottom: calc(100% - 4px); z-index: 5; padding: 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); box-shadow: 0 6px 20px rgb(0 0 0 / 0.12); }
  .user-menu button { width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 10px; font-size: 14px; }
  .user-menu button:hover { background: var(--hover); }
  .who-btn { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 0; border-radius: 8px; background: transparent; text-align: left; font-size: 14px; }
  .who-btn:hover { background: var(--hover); }
  .avatar { width: 22px; height: 22px; border-radius: 50%; background: #d7eef3; color: var(--accent); display: grid; place-items: center; font-size: 12px; font-weight: 700; flex: none; }
  .who-btn.on { background: #fff; box-shadow: inset 0 0 0 1px var(--border); }
  .sec-row { display: flex; align-items: center; padding: 8px 8px 4px 14px; }
  .sec-row .sec { padding: 0; flex: 1; }
  .icon-btn { width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--muted); padding: 0; }
  .icon-btn:hover { background: var(--hover); color: var(--text); }
  #new-name { margin: 0 8px 8px; }
  #new-name input { width: 100%; }
  .sec { padding: 8px 14px 4px; font-size: 12px; color: var(--muted); font-weight: 600; }
  .item, .add { margin: 0 8px; padding: 8px 10px; border-radius: 8px; display: flex; align-items: center; gap: 8px; background: none; border: 0; text-align: left; width: calc(100% - 16px); }
  .item.on { background: #fff; box-shadow: inset 0 0 0 1px var(--border); }
  .item:hover, .add:hover { background: var(--hover); }
  .item .name { flex: 1; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #c5c9d0; flex: none; }
  .dot.on { background: var(--ok); }
  .meta, .add { color: var(--muted); font-size: 13px; }
  .member { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--border); }
  .role { margin-left: auto; font-size: 12px; color: var(--muted); }
  .inline { display: flex; gap: 8px; margin-top: 12px; }
  .inline input { flex: 1; min-width: 0; }
  .settings { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .settings-body { padding: 28px; max-width: 560px; }
  #chat { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  #chat[hidden], #settings[hidden] { display: none; }
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .top { height: 48px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 16px; gap: 10px; }
  .top .sub { color: var(--muted); font-size: 13px; }
  .thread { flex: 1; overflow: auto; padding: 20px 28px 8px; }
  .msg { max-width: 640px; margin-bottom: 16px; }
  .msg.user { margin-left: auto; background: var(--panel); border-radius: 12px; padding: 8px 12px; width: fit-content; }
  .who2, .tool { font-size: 13px; color: var(--muted); }
  .tool code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; background: var(--panel); padding: 1px 6px; border-radius: 4px; color: var(--text); }
  .note { margin: 0 28px 10px; padding: 8px 12px; border-radius: 8px; background: #fff7ed; color: var(--warn); font-size: 13px; }
  .composer { margin: 0 20px 8px; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; display: flex; gap: 8px; align-items: flex-end; }
  .composer textarea { flex: 1; border: 0; resize: none; outline: none; font: inherit; min-height: 24px; }
  .status { height: 36px; display: flex; align-items: center; padding: 0 20px; color: var(--muted); font-size: 12px; }
  .empty { color: var(--muted); padding: 24px; }
</style>
</head>
<body>
  <div id="login">
    <form id="login-form">
      <h1><span class="mark">t</span> tah</h1>
      <input name="username" placeholder="用户名" autocomplete="username" required />
      <input name="password" type="password" placeholder="密码" autocomplete="current-password" required />
      <button class="primary" type="submit">登录</button>
      <div class="err" id="login-err"></div>
    </form>
  </div>
  <div id="app">
    <div class="window">
      <aside class="side">
        <div class="brand"><span class="mark">t</span> tah</div>
        <div class="sec-row">
          <div class="sec">项目</div>
          <button type="button" class="icon-btn" id="new-project" title="新建项目" aria-label="新建项目">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M13.5 8.5v4a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12.5V4A1.5 1.5 0 0 1 4 2.5h4M11.5 1.8l2.7 2.7L8.5 10.2H5.8V7.5z" stroke-linecap="round" stroke-linejoin="round"></path></svg>
          </button>
        </div>
        <form id="new-name" hidden><input name="name" placeholder="项目名称" required /></form>
        <div id="projects"></div>
        <div class="who">
          <div class="user-menu" id="user-menu" hidden>
            <button type="button" id="menu-members">成员</button>
            <button type="button" id="logout">退出</button>
          </div>
          <button type="button" class="who-btn" id="user-btn"><span class="avatar" id="avatar"></span><span id="username"></span></button>
        </div>
      </aside>
      <main class="main">
        <div id="chat">
          <div class="top"><b id="title">选择一个项目</b><span class="sub" id="subtitle"></span></div>
          <div class="thread" id="thread"></div>
          <div class="note">这个项目里的 Agent 只能读和回答，不能改文件，也不能跑命令。刷新后这里不回放更早的消息，接着聊仍然记得。</div>
          <form class="composer" id="composer">
            <textarea id="draft" rows="1" placeholder="发消息"></textarea>
            <button class="primary" type="submit" id="send">发送</button>
          </form>
          <div class="status" id="status"></div>
        </div>
        <div id="settings" class="settings" hidden>
          <div class="top"><button type="button" class="link" id="settings-back">返回</button><b>成员</b></div>
          <div class="settings-body">
            <div class="sub" id="settings-project"></div>
            <div id="settings-members"></div>
            <form class="inline" id="add-member" hidden>
              <input name="username" placeholder="用户名" required />
              <button type="submit">添加</button>
            </form>
            <div class="err" id="member-err"></div>
          </div>
        </div>
      </main>
    </div>
  </div>
<script>
const $ = (id) => document.getElementById(id);
let me = null;
let projects = [];
let current = null;
let members = [];
let sessionId = "";
let rounds = 0;
let tokens = null;
let busy = false;
let booting = false;
const lines = [];

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body && body.error ? body.error : String(res.status));
  return body;
}

function roleLabel(role) { return role === "owner" ? "所有者" : "成员"; }

function renderProjects() {
  const box = $("projects");
  box.replaceChildren();
  for (const project of projects) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item" + (current && current.id === project.id ? " on" : "");
    const dot = document.createElement("span");
    dot.className = "dot" + (project.running ? " on" : "");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = project.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = project.running ? "运行中" : "已停止";
    btn.append(dot, name, meta);
    btn.onclick = () => openProject(project);
    box.append(btn);
  }
}

function renderSettingsMembers() {
  const box = $("settings-members");
  box.replaceChildren();
  $("member-err").textContent = "";
  if (!current) {
    $("settings-project").textContent = "先在左边选择一个项目。";
    $("add-member").hidden = true;
    return;
  }
  $("settings-project").textContent = current.name + (current.role === "owner" ? " · 你可以添加成员" : " · 只有所有者可以添加成员");
  for (const member of members) {
    const row = document.createElement("div");
    row.className = "member";
    const name = document.createElement("b");
    name.textContent = member.username;
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = roleLabel(member.role);
    row.append(name, role);
    box.append(row);
  }
  $("add-member").hidden = current.role !== "owner";
}

function showChat() {
  $("settings").hidden = true;
  $("chat").hidden = false;
  $("user-menu").hidden = true;
  $("user-btn").classList.remove("on");
}

async function showSettings() {
  $("user-menu").hidden = true;
  $("chat").hidden = true;
  $("settings").hidden = false;
  $("user-btn").classList.add("on");
  members = current ? await api("/api/projects/" + current.id + "/members") : [];
  renderSettingsMembers();
}

function renderThread() {
  const box = $("thread");
  box.replaceChildren();
  if (!current) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "在左边新建或选择一个项目。";
    box.append(empty);
    return;
  }
  if (lines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = booting ? "正在启动容器…" : "发一条消息开始。";
    box.append(empty);
  }
  for (const line of lines) {
    const div = document.createElement("div");
    div.className = "msg" + (line.kind === "user" ? " user" : "");
    if (line.kind === "assistant") {
      const who = document.createElement("div");
      who.className = "who2";
      who.textContent = current.name;
      div.append(who);
    }
    if (line.tool) {
      const tool = document.createElement("div");
      tool.className = "tool";
      tool.textContent = line.tool + (line.ok === false ? " ✗" : line.ok ? " ✓" : " …");
      div.append(tool);
    }
    if (line.text) {
      const text = document.createElement("div");
      text.textContent = line.text;
      div.append(text);
    }
    box.append(div);
  }
  box.scrollTop = box.scrollHeight;
}

function renderStatus() {
  if (!current) { $("status").textContent = ""; return; }
  const parts = [current.name];
  if (sessionId) parts.push(sessionId);
  parts.push(rounds + " 轮");
  if (tokens && tokens.promptTokens + tokens.completionTokens > 0) {
    parts.push("in " + tokens.promptTokens.toLocaleString("en-US") + " · out " + tokens.completionTokens.toLocaleString("en-US"));
  }
  parts.push(current.running ? "容器运行中" : "容器已停止");
  $("status").textContent = parts.join(" · ");
  $("title").textContent = current.name;
  $("subtitle").textContent = "打开这个项目时容器会自动起来";
  $("draft").placeholder = "给" + current.name + "发消息";
  $("send").disabled = busy || booting || !sessionId;
}

function showApp() {
  $("login").style.display = "none";
  $("app").style.display = "block";
  $("avatar").textContent = me.username.slice(0, 1);
  $("username").textContent = me.username;
  renderProjects();
  renderThread();
  renderStatus();
}

async function refreshProjects() {
  projects = await api("/api/projects");
  if (current) current = projects.find((p) => p.id === current.id) || current;
  renderProjects();
  renderStatus();
}

async function openProject(project) {
  current = project;
  showChat();
  lines.length = 0;
  sessionId = "";
  rounds = 0;
  tokens = null;
  booting = true;
  renderProjects();
  renderThread();
  renderStatus();
  try {
    await api("/api/projects/" + project.id + "/wake", { method: "POST" });
    project.running = true;
    const listed = await api("/api/projects/" + project.id + "/agent/v1/sessions");
    if (listed.length) {
      listed.sort((a, b) => b.updatedAt - a.updatedAt);
      sessionId = listed[0].id;
    } else {
      const created = await api("/api/projects/" + project.id + "/agent/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      sessionId = created.sessionId;
    }
    await refreshProjects();
  } catch (err) {
    lines.push({ kind: "assistant", text: err.message });
  } finally {
    booting = false;
    renderThread();
    renderStatus();
  }
}

function applyEvent(event) {
  if (event.type === "user") lines.push({ kind: "user", text: event.text });
  else if (event.type === "text") {
    const last = lines.at(-1);
    if (last && last.kind === "assistant" && !last.tool) last.text += event.delta;
    else lines.push({ kind: "assistant", text: event.delta });
  } else if (event.type === "tool.start") {
    lines.push({ kind: "assistant", tool: event.tool + " " + (event.summary || ""), text: "" });
  } else if (event.type === "tool.end") {
    const line = [...lines].reverse().find((item) => item.tool && item.tool.startsWith(event.tool));
    if (line) line.ok = event.ok;
  } else if (event.type === "notice") {
    lines.push({ kind: "assistant", text: event.text });
  } else if (event.type === "turn.end") {
    rounds = event.rounds || rounds;
    if (event.sessionUsage) tokens = event.sessionUsage;
    busy = false;
  } else if (event.type === "turn.error") {
    lines.push({ kind: "assistant", text: event.message });
    if (event.sessionUsage) tokens = event.sessionUsage;
    busy = false;
  }
  renderThread();
  renderStatus();
}

async function send(text) {
  busy = true;
  renderStatus();
  const res = await fetch("/api/projects/" + current.id + "/agent/v1/sessions/" + encodeURIComponent(sessionId) + "/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    lines.push({ kind: "assistant", text: body.error || "发送失败" });
    busy = false;
    renderThread();
    renderStatus();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const parts = buf.split("\\n\\n");
    buf = parts.pop();
    for (const part of parts) {
      const data = part.split("\\n").filter((row) => row.startsWith("data: ")).map((row) => row.slice(6)).join("\\n");
      if (data) applyEvent(JSON.parse(data));
    }
  }
  busy = false;
  renderStatus();
}

$("login-form").onsubmit = async (event) => {
  event.preventDefault();
  $("login-err").textContent = "";
  const data = new FormData(event.target);
  try {
    me = await api("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    await refreshProjects();
    showApp();
    if (projects[0]) await openProject(projects[0]);
  } catch (err) {
    $("login-err").textContent = err.message;
  }
};

$("user-btn").onclick = (event) => {
  event.stopPropagation();
  $("user-menu").hidden = !$("user-menu").hidden;
};
$("user-menu").onclick = (event) => event.stopPropagation();
document.addEventListener("click", () => { $("user-menu").hidden = true; });
$("menu-members").onclick = () => { void showSettings(); };
$("settings-back").onclick = () => showChat();
$("logout").onclick = async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
};
$("add-member").onsubmit = async (event) => {
  event.preventDefault();
  $("member-err").textContent = "";
  const username = new FormData(event.target).get("username");
  try {
    await api("/api/projects/" + current.id + "/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, role: "member" }),
    });
    event.target.reset();
    members = await api("/api/projects/" + current.id + "/members");
    renderSettingsMembers();
  } catch (err) {
    $("member-err").textContent = err.message;
  }
};

function closeNewProject() {
  $("new-name").hidden = true;
  $("new-name").reset();
}
$("new-project").onclick = () => {
  $("new-name").hidden = !$("new-name").hidden;
  if (!$("new-name").hidden) $("new-name").querySelector("input").focus();
};
$("new-name").querySelector("input").addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeNewProject();
});
$("new-name").onsubmit = async (event) => {
  event.preventDefault();
  const name = new FormData(event.target).get("name");
  const created = await api("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  closeNewProject();
  await refreshProjects();
  const project = projects.find((item) => item.id === created.id);
  if (project) await openProject(project);
};

function submitDraft() {
  const draft = $("draft");
  const text = draft.value.trim();
  if (!text || !sessionId || busy) return;
  draft.value = "";
  void send(text);
}

$("composer").onsubmit = (event) => {
  event.preventDefault();
  submitDraft();
};

let plainEnter = false;
$("draft").addEventListener("keydown", (event) => {
  plainEnter = event.key === "Enter" && !event.shiftKey && !event.isComposing;
  if (!plainEnter) return;
  event.preventDefault();
  submitDraft();
});
$("draft").addEventListener("beforeinput", (event) => {
  if (plainEnter && event.inputType === "insertLineBreak") event.preventDefault();
});
$("draft").addEventListener("keyup", (event) => {
  if (event.key === "Enter") plainEnter = false;
});

api("/api/me").then(async (user) => {
  me = user;
  await refreshProjects();
  showApp();
  if (projects[0]) await openProject(projects[0]);
}).catch(() => {});
</script>
</body>
</html>
`;
