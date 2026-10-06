import { defineConfig } from "vitepress";

/**
 * GitHub Pages project site needs `base: '/<repo>/'`.
 * Local / custom domain: leave DOCS_BASE unset or set to '/'.
 *
 * Note: mermaid diagrams in markdown render as fenced code locally/on Pages
 * until a lightweight renderer is wired; avoid vitepress-plugin-mermaid under
 * pnpm (broken optimizeDeps / missing nested peers).
 */
const base = process.env.DOCS_BASE ?? "/";

const repo =
  process.env.DOCS_REPO_URL ?? "https://github.com/MichaelVendor/typescript-agent-harness";

const guideSidebar = [
  {
    text: "开始",
    items: [
      { text: "快速开始", link: "/guide/getting-started" },
      { text: "文档状态说明", link: "/guide/status" },
    ],
  },
  {
    text: "设计",
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
      { text: "CLI", link: "/guide/cli" },
    ],
  },
  {
    text: "扩展",
    items: [
      { text: "编写插件", link: "/guide/plugins" },
      { text: "路线图", link: "/guide/roadmap" },
    ],
  },
  {
    text: "API 参考",
    items: [{ text: "@typescript-agent-harness/core", link: "/api/core" }],
  },
];

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
      { text: "架构", link: "/guide/architecture" },
      { text: "API", link: "/api/core", activeMatch: "/api/" },
      { text: "路线图", link: "/guide/roadmap" },
    ],

    sidebar: {
      "/guide/": guideSidebar,
      "/api/": guideSidebar,
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
