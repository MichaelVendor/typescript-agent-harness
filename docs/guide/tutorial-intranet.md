# 教程：把控制面接到公司内网

在一台内网机器上跑起控制面。做完之后，同事用浏览器打开一个地址，用自己的用户名密码登录，在项目里和 Agent 对话。你也会改这个项目的人设，并改控制面网页上的一句文案。

控制面是仓库里的私有包 `apps/control`，不发布到 npm。浏览器只访问它。每个项目对应一个 Docker 容器，容器里跑 `tah agent-host`。模型密钥和共享密钥留在这台机器的环境变量里。

接口、环境变量和边界的对照表见 [内网控制面](/design/control-plane)。容器里的 `/v1` 见 [AgentHost](/design/agent-host)。

## 你需要准备

- 一台公司内网机器，同事能访问它的 `7810` 端口。控制面和 Docker 装在同一台机器上。
- 这台机器已安装 Docker、Node.js ≥ 22、[pnpm](https://pnpm.io) ≥ 10、git。
- 一个模型密钥：`DEEPSEEK_API_KEY`，或 `OPENAI_API_KEY`。
- 这台机器能构建镜像（拉 `node:22-bookworm-slim`，并在构建时安装依赖）。

`7810` 只对办公网开放。登录目前是用户名加密码，还没有公司单点登录。

## 1. 拿源码并装依赖

在内网机器上：

```sh
git clone https://github.com/MichaelVendor/typescript-agent-harness.git
cd typescript-agent-harness
pnpm install
node -v
docker version
```

`node -v` 应是 v22 或更高。`docker version` 能打出 Client 和 Server。若提示找不到 `docker`，先装 Docker，再继续。这一步还没有网页。

聊天页是 `apps/control/src/page.ts`。部署用包含这个文件的源码。已发布的 `v1.1.0` 还没有这张页面。

## 2. 构建 Agent 镜像

在仓库根目录：

```sh
docker build -f apps/control/Dockerfile -t tah-agent-host .
docker images tah-agent-host
```

镜像名必须是 `tah-agent-host`（或之后把 `CONTROL_IMAGE` 设成你起的名字）。控制面创建项目时用这个镜像起容器，不把容器端口发布到宿主机。构建要几分钟。结束时 `docker images` 里能看到 `tah-agent-host`。

## 3. 写入密钥、账号，并启动

先建数据目录和密钥。把下面的 `换成你的密钥` 换成真实值，不要把这个文件提交进 git。

```sh
sudo mkdir -p /var/lib/tah-control
sudo chown "$USER" /var/lib/tah-control
umask 077
cat > "$HOME/tah-control.env" << 'EOF'
AR_SHARED_SECRET=换成至少32位的随机串
DEEPSEEK_API_KEY=换成你的密钥
CONTROL_HOST=0.0.0.0
CONTROL_PORT=7810
CONTROL_DATA=/var/lib/tah-control
EOF
```

`AR_SHARED_SECRET` 可用 `openssl rand -hex 32` 生成。控制面用它给每个容器签发短时令牌，容器用同一个值校验。缺了这个变量，进程会直接退出。

只用 OpenAI 兼容接口时，把 `DEEPSEEK_API_KEY=...` 换成 `OPENAI_API_KEY=...`。官方启动程序读这两个环境变量，不读 `~/.tah/settings.json`。

构建控制面，并写入第一个用户。把用户名和密码换成你自己的：

```sh
set -a
source "$HOME/tah-control.env"
set +a

pnpm --filter @typescript-agent-harness/control build

node --input-type=module -e '
import { openStore } from "./apps/control/dist/store.js";
import { hashPassword } from "./apps/control/dist/auth.js";
const store = openStore(process.env.CONTROL_DATA + "/control.db");
store.createUser("lin", hashPassword("换成lin的密码"));
'
```

没有自助注册接口。每个要登录的人都要先有一条用户记录。上面这条是所有者账号，后面用它创建项目。

启动：

```sh
set -a
source "$HOME/tah-control.env"
set +a
node apps/control/dist/main.js
```

终端打出：

```text
control listening on http://0.0.0.0:7810
```

另开一个终端检查登录页和未登录接口：

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7810/api/me
curl -s http://127.0.0.1:7810/ | head -c 200
```

`/api/me` 返回 `401`。`/` 的内容里有「登录」。用内网另一台电脑打开 `http://<这台机器的内网IP>:7810`，应看到同一张登录表单。打不开时看防火墙是否放行 `7810`，以及 `CONTROL_HOST` 是否为 `0.0.0.0`。

进程停掉后，内存里的登录会话会消失，每个人要重新登录。用户、项目和成员在 `/var/lib/tah-control/control.db`，还在。

要一直跑着，可以用 systemd（把 `User` 换成能执行 `docker` 的账号，该账号也要能写 `/var/lib/tah-control`）：

```ini
# /etc/systemd/system/tah-control.service
[Unit]
Description=tah intranet control plane
After=docker.service
Requires=docker.service

[Service]
User=换成运行账号
WorkingDirectory=/换成仓库路径/typescript-agent-harness
EnvironmentFile=/换成家目录/tah-control.env
ExecStart=/usr/bin/node apps/control/dist/main.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now tah-control
sudo systemctl status tah-control
```

后面的步骤假定这个进程已经在听 `7810`。改完网页要重启它。

## 4. 登录，建项目，发一句话

浏览器打开 `http://<内网IP>:7810`。

1. 用第 3 步的用户名和密码点「登录」。左侧出现「项目」。
2. 点「项目」右边的图标，输入项目名称（例如 `值班助手`），回车。
3. 点这个项目。第一次打开会启动容器，状态从「已停止」变成「运行中」。底部状态行会出现「容器运行中」。
4. 在输入框写 `用一句话说你现在能做什么`，回车。

回复出现在对话区。状态行里的 `in` / `out` 是这次进程打开该会话后的 token 合计。Shift+回车换行。回车发送，输入框会清空。

这一步如果项目一直起不来：

- 页面或接口是 **503**：容器在 60 秒内没有健康。在服务器上执行 `docker ps -a` 和 `docker logs tah-project-<项目id>`。项目 id 是 `/var/lib/tah-control/projects/` 下的目录名。
- **500** 且日志里是找不到 `docker`：这个进程所在的账号没有 Docker。
- 回复报模型错误：检查 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY` 已写进环境，并且是在启动控制面之前导出的。改环境变量后要重启控制面，再重新打开项目（空闲停掉的容器下次会用新环境拉起；已经在跑的容器仍是旧环境，可 `docker rm -f tah-project-<项目id>` 后在网页里再打开）。

空闲 30 分钟没有任何代理请求时，控制面会 `docker stop` 这个容器，数据卷保留。下次打开项目会再启动。

页面上的说明是准确的：这个 Agent 只能读和回答，不能改文件，也不能跑命令。刷新页面不会把更早的消息再画出来，接着聊时会话仍在。

## 5. 让同事登录

控制面停掉后再写用户，避免两个进程同时写同一个 SQLite 文件。写完再启动。

```sh
set -a
source "$HOME/tah-control.env"
set +a
node --input-type=module -e '
import { openStore } from "./apps/control/dist/store.js";
import { hashPassword } from "./apps/control/dist/auth.js";
const store = openStore(process.env.CONTROL_DATA + "/control.db");
store.createUser("wang", hashPassword("换成wang的密码"));
'
```

把用户名和初始密码交给同事。同事打开同一个内网地址登录。此时左侧没有「值班助手」，因为还不是成员。

用 `lin` 登录，点左下角自己的名字，点「成员」。在用户名框输入 `wang`，点「添加」。列表里会出现 `wang`，角色是「成员」。成员能打开项目并聊天。添加成员的人是项目的所有者。

`wang` 刷新后能看到该项目。点左下角名字里的「退出」可以换账号。

用户名必须已经在第 3 步这种写入里存在。页面上的添加不会创建新账号。重复添加同一个用户会失败。

## 6. 定制这个项目的 Agent

人设和工具放在该项目的工作区目录，容器把它挂到 `/workspace`：

```text
/var/lib/tah-control/projects/<项目id>/workspace/
```

`<项目id>` 用 `ls /var/lib/tah-control/projects` 查看。在服务器上直接改这些文件。容器里的 Agent 没有写文件和执行命令的能力，所以定制由你在宿主机完成。

先写人设。把下面保存为该目录的 `AGENTS.md`：

```markdown
你是公司值班助手。

- 用中文回答。
- 回答先给结论，再补一句依据。
- 不知道的就说不知道，不要编。
```

保存后在网页里再发一句 `你是谁`。容器默认会监视 `AGENTS.md`、`tools/`、`skills/` 的变化。回复应改口为值班助手。若仍是旧人设，确认你改的是这个项目 id 的目录，然后在服务器上执行 `docker restart tah-project-<项目id>`，回到网页再发一句。

工具是工作区里的 `tools/<名字>.ts`，文件名 `current-time.ts` 会变成工具 `current_time`。这些文件要能在工作区里解析到 `@typescript-agent-harness/cli`，所以在**服务器上、这个工作区目录里**安装依赖（容器和工作区是同一批文件）：

```sh
cd /var/lib/tah-control/projects/<项目id>/workspace
npm install @typescript-agent-harness/cli
```

然后保存 `tools/current-time.ts`：

```ts
import { defineTool } from "@typescript-agent-harness/cli";

export default defineTool({
  description: "返回当前时间的 ISO 字符串和时区。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    return {
      now: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
});
```

在网页里问 `现在几点`。回复里应出现工具调用和时间。安装失败时，看这台机器能否访问 npm；公司有私有源就改用私有源。工具怎么设计，见 [教程：做一个文档问答 Agent](/guide/tutorial-docs-agent) 和 [CLI · 约定式项目](/guide/cli)。

`tah init` 会在当前目录生成一套同样的 `AGENTS.md`、`tools/`、`skills/`。可以在空目录里 init，再把生成的文件拷进上面的 `workspace/`。它不改控制面网页。

## 7. 改控制面网页

网页是一份页面，源码在 `apps/control/src/page.ts`。登录、项目列表、成员和对话都在这里，请求只发到控制面自己的 `/api/...`。

把页面里这句：

```text
这个项目里的 Agent 只能读和回答，不能改文件，也不能跑命令。刷新后这里不回放更早的消息，接着聊仍然记得。
```

改成你们想给同事看的说明，例如加上内部支持渠道。然后在仓库根目录：

```sh
pnpm --filter @typescript-agent-harness/control build
```

重启控制面（systemd 时用 `sudo systemctl restart tah-control`）。同事重新登录，打开项目，输入框上方就是新说明。

用户和项目仍在 `control.db`。重启只清掉登录会话。

## 这一步失败时

| 现象 | 处理 |
| --- | --- |
| 启动即退出，日志是 `AR_SHARED_SECRET is required` | 先 `source` 环境文件再启动，或让 systemd 的 `EnvironmentFile` 指向它 |
| 浏览器登录页只有本机能开 | `CONTROL_HOST` 仍是默认的 `127.0.0.1`。改成 `0.0.0.0` 后重启 |
| 登录返回用户名或密码错误 | 用户还没写入 SQLite，或密码和 `hashPassword` 时不一致。按第 5 步再写一条 |
| 打开项目 503 | `docker logs tah-project-<id>`。常见是镜像名不对，或 60 秒内健康检查没过 |
| 能打开项目，模型报错 | 密钥没进容器。确认启动控制面的环境里有 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`，删掉旧容器后再打开项目 |
| 改了 `AGENTS.md` 没有生效 | 路径不是这个项目的 `workspace/`，或容器没读到新文件。`docker restart tah-project-<id>` |
| 工具加载失败，提示包没安装 | 在该 `workspace/` 里执行 `npm install @typescript-agent-harness/cli` |
| 同事看不到项目 | 还不是成员。所有者在「成员」里添加已存在的用户名 |

## 你现在有什么

同事通过 `http://<内网IP>:7810` 登录，在被加入的项目里聊天。项目的人设和工具在 `/var/lib/tah-control/projects/<id>/workspace`。网页文案在 `apps/control/src/page.ts`，改完构建并重启即可。

接下来可以继续往工作区加工具和 `skills/`。登录换成公司 SSO、多机编排、计费都不在这一版里，设计边界写在 [内网控制面](/design/control-plane)。
