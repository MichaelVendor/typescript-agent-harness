import { defineConfig } from "vitepress";

/**
 * GitHub Pages project site needs `base: '/<repo>/'`.
 * Local / custom domain: leave DOCS_BASE unset or set to '/'.
 *
 * Note: mermaid diagrams in markdown render as fenced code locally/on Pages
 * until a lightweight renderer is wired; avoid vitepress-plugin-mermaid under
 * pnpm (broken optimizeDeps / missing nested peers).
 *
 * Nav model (aligned with Vite / VitePress): Guide vs Config/Reference.
 * - `/guide/` — how to use
 * - `/design/` — design notes + config reference (tah.config.json)
 * - `/api/` — package API
 */
const base = process.env.DOCS_BASE ?? "/";

const repo =
  process.env.DOCS_REPO_URL ?? "https://github.com/MichaelVendor/typescript-agent-harness";

/** Guide: learn and use. */
function sidebarGuide() {
  return [
    {
      text: "开始",
      items: [
        { text: "快速开始", link: "/guide/getting-started" },
        { text: "教程：文档问答 Agent", link: "/guide/tutorial-docs-agent" },
        { text: "文档状态说明", link: "/guide/status" },
        { text: "版本踩坑与改动", link: "/guide/lessons" },
      ],
    },
    {
      text: "概念",
      items: [
        { text: "设计哲学", link: "/guide/philosophy" },
        { text: "整体架构", link: "/guide/architecture" },
      ],
    },
    {
      text: "核心",
      items: [
        { text: "Runtime", link: "/guide/runtime" },
        { text: "Agent 与 Session", link: "/guide/agent-session" },
        { text: "LLM", link: "/guide/llm" },
        { text: "Tools 与 Runnable", link: "/guide/tools" },
        { text: "Storage 与 Checkpoint", link: "/guide/storage" },
        { text: "事件目录", link: "/guide/events" },
        { text: "生态", link: "/guide/ecosystem" },
      ],
    },
    {
      text: "使用",
      items: [
        { text: "CLI", link: "/guide/cli" },
        { text: "配置 tah.config.json", link: "/design/config" },
        { text: "编写插件", link: "/guide/plugins" },
        { text: "路线图", link: "/guide/roadmap" },
      ],
    },
  ];
}

/** Design notes + config reference (separate from day-1 guide). */
function sidebarDesign() {
  return [
    {
      text: "配置参考",
      items: [{ text: "tah.config.json", link: "/design/config" }],
    },
    {
      text: "设计说明",
      collapsed: false,
      items: [
        { text: "约定式项目", link: "/design/project-convention" },
        { text: "约定式热更新", link: "/design/reload" },
        { text: "TUI 与会话接口", link: "/design/tui" },
        { text: "tah serve", link: "/design/serve" },
        { text: "附件", link: "/design/attachments" },
      ],
    },
    {
      text: "回到指南",
      items: [
        { text: "快速开始", link: "/guide/getting-started" },
        { text: "CLI 用法", link: "/guide/cli" },
      ],
    },
  ];
}

function sidebarApi() {
  return [
    {
      text: "API 参考",
      items: [{ text: "@typescript-agent-harness/core", link: "/api/core" }],
    },
    {
      text: "相关",
      items: [
        { text: "配置 tah.config.json", link: "/design/config" },
        { text: "CLI", link: "/guide/cli" },
      ],
    },
  ];
}

export default defineConfig({
  lang: "zh-CN",
  title: "typescript-agent-harness",
  description:
    "TypeScript Agent Runtime — Everything is a capability. 开源 Agent Runtime 框架文档。",
  base,
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: [
    // Monorepo paths resolved on GitHub, not on the docs host.
    /^https?:\/\/github\.com/,
  ],

  head: [
    ["meta", { name: "theme-color", content: "#0f172a" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "typescript-agent-harness" }],
    [
      "meta",
      {
        property: "og:description",
        content: "TypeScript Agent Runtime — Everything is a capability.",
      },
    ],
  ],

  themeConfig: {
    logo: { text: "TAH" },
    siteTitle: "typescript-agent-harness",
    outline: { label: "本页目录", level: [2, 3] },
    lastUpdated: { text: "最后更新" },
    docFooter: { prev: "上一页", next: "下一页" },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "主题",
    lightModeSwitchTitle: "切换到浅色",
    darkModeSwitchTitle: "切换到深色",

    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
          modal: {
            noResultsText: "没有结果",
            resetButtonTitle: "清除",
            footer: {
              selectText: "选择",
              navigateText: "切换",
              closeText: "关闭",
            },
          },
        },
      },
    },

    nav: [
      { text: "指南", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "CLI", link: "/guide/cli" },
      { text: "配置", link: "/design/config", activeMatch: "/design/" },
      { text: "API", link: "/api/core", activeMatch: "/api/" },
      { text: "路线图", link: "/guide/roadmap" },
    ],

    sidebar: {
      "/guide/": sidebarGuide(),
      "/design/": sidebarDesign(),
      "/api/": sidebarApi(),
    },

    socialLinks: [{ icon: "github", link: repo }],

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: "在 GitHub 上编辑此页",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © typescript-agent-harness contributors",
    },
  },

  markdown: {
    theme: { light: "github-light", dark: "github-dark" },
    lineNumbers: true,
  },
});
