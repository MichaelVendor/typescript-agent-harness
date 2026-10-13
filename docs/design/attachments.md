# 设计说明：附件（`tah serve`）

状态：✅ 已实现（v0.27）

## 背景

本机网页工作台里，贴截图、拖日志是日常操作。DeepSeek Harness 用「上传 → 内容寻址引用 → 会话只存引用；通用文件给路径让工具读」解决这件事。tah 对齐这条思路，但第一版只做 `tah serve`，不进 TUI / `tah run`。

原则（见 [设计哲学](../guide/philosophy.md)）：界面与存储属 Application 层；`core` 不为此加接口。阶段 1 不改 `Session.run(string)` 签名，由 Host 把路径说明拼进文本。

## 目标

- `tah serve` 可选择 / 拖拽 / 粘贴文件与图片，上传到本机，发送时附上引用。
- 会话与 SQLite 只存附件元数据引用，不存文件字节或 base64。
- 默认（含 DeepSeek 文本模型）：不拒收图片；user 消息附带只读绝对路径，模型用 `read_file` 等工具按需读。
- 可选 `--vision` / `TAH_VISION=1`：把图片投影进 OpenAI 兼容多模态请求（模型须支持视觉）。

## 非目标

- TUI / `tah run --attach`
- 独立视觉旁路模型（另调模型把图转成字）
- 音频 / 视频专用管线
- 对外暴露、放宽 `Host` / `Origin`
- 新建对外发布的 `packages/attachments`（需要时再抽）

## 架构

```text
浏览器 Composer                    tah serve
┌─────────────────────┐  POST     ┌──────────────────────────────┐
│ 草稿附件栏            │ ───────▶ │ /api/attachments  写入 store   │
│ 发送 text+ids        │ ───────▶ │ /api/send         Host 投影   │
└─────────────────────┘           │ attachments/      内容寻址盘  │
                                  └──────────────┬───────────────┘
                                                 │ path text (v1)
                                                 │ or multimodal (vision)
                                            Session / LLM
```

| 单元 | 职责 |
| --- | --- |
| `packages/cli/src/attachments/` | 校验、sha256 去重写入、按 id 解析路径 |
| `packages/cli/src/serve/http.ts` | 上传与扩展后的 send |
| `packages/cli/src/host.ts` | 拼路径说明；`HistoryItem` / 事件带附件元数据 |
| `packages/web` | 附件栏与历史卡片 |
| `packages/llm`（vision） | `user` content parts + `image_url` |

存储根：`<cwd>/.tah/attachments/`（与 `cli.db` 同级）。

## 限额与 MIME

| 项 | 值 |
| --- | --- |
| 图片 MIME | `image/png`、`image/jpeg`、`image/webp`、`image/gif` |
| 单张图片 | ≤ 20 MiB |
| 每条消息图片数 | ≤ 20 |
| 通用文件 | 任意 MIME（非上述图片走文件路径）；单文件 ≤ 32 MiB |
| 每条消息附件总数 | ≤ 40 |

超过限额在上传或发送时返回 400，不写入半截对象。

## 安全

- 仅本机：沿用 serve 的 cookie、`Host` / `Origin` 校验；上传路由同样要求已登录。
- 附件只写在 `<cwd>/.tah/attachments/`，不接受任意宿主路径作为上传目标。
- 会话 JSON 只含 id / kind / name / mime / bytes / sha256，不含文件内容。
- 约定式项目若关闭了内置工具，模型读附件需要 `--builtin-tools` 或自备读文件工具。

## 路径投影（默认）

Host 在调用 `Session.run` 前把说明追加到 user 文本，例如：

```text
<用户正文>

[attachments]
- file report.log → /abs/.../.tah/attachments/objects/<sha>/report.log (text/plain, 12KB)
- image shot.png → /abs/.../.tah/attachments/objects/<sha>/shot.png (image/png, 200KB). This model cannot see images; call read_image_text with this path to read the text in it.
```

图片那行的提示随模型变（v0.33）：模型能看图时是「The image is attached to this message.」；不能看图但有 `read_image_text`（macOS）时如上；都没有时让模型请用户描述。

网页历史用结构化 `attachments` 字段展示卡片，不把上述整段路径块当作唯一 UI。

## Vision（可选）

- 谁决定（v0.33）：Settings 里选中的模型看它自己的「Can read images」（`~/.tah/settings.json` 里的 `vision: true`）；用 `.env` 模型时看 `tah serve --vision` / `TAH_VISION=1` / `tah.config.json` 的 `capabilities.vision`。
- 开启后：图片以 `image_url`（data URL 或可读投影）进入 LLM 请求；DB 仍只存 ref，请求前从 store 读取。
- 未开启：永远走路径投影，不猜模型名；会话里之前发过的图片在请求里换成 `[image omitted]` 文字（换到不能看图的模型时不会被接口拒）。

## 读图里的字（OCR，v0.33，仅 macOS）

- 内置工具 `read_image_text {path}`：用系统 Vision 框架（`osascript -l JavaScript`）在本机识别中英文，返回识别出的行；没字时返回「(no text found in the image)」，不是图片时报「not a readable image」。不描述图片内容。
- 跟内置文件工具一起挂（`capabilities.coding`），只读、不用审批，路径限制在工作目录内（附件就在 `<cwd>/.tah/attachments/`）；30 秒超时。
- Windows / Linux 不挂这个工具。

## 与 DeepSeek Harness 的差异

- 无独立 `attachment` / `attachment-local` 产品包；实现放在 CLI 应用层。
- 无视觉旁路模型；纯文本模型靠路径 + 工具（macOS 上可用 `read_image_text` 读图中文字）。
- 通用文件有 32 MiB 上限（dsh 文档写「不设类型与大小限制」），避免本机工作台被撑满。

## 验收

```sh
pnpm tah -- serve --mock
# 网页附文本文件与图片发送；历史有卡片；mock/真模型能看到路径说明
pnpm tah -- serve --vision   # 视觉模型时图片进请求
```
