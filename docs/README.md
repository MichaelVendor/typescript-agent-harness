# 文档源码

本目录是 [VitePress](https://vitepress.dev) 文档站源码。

## 本地预览

在仓库根目录：

```sh
pnpm install
pnpm docs:dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。

## 构建

```sh
pnpm docs:build
```

产物在 `docs/.vitepress/dist`。推送到 `main` 后由 GitHub Actions 部署到 GitHub Pages。

## 阅读入口

- 站点首页：[`index.md`](./index.md)
- 快速开始：[`guide/getting-started.md`](./guide/getting-started.md)
- CLI：[`guide/cli.md`](./guide/cli.md)
- 文档状态：[`guide/status.md`](./guide/status.md)

完整章节见站点侧边栏。顺序阅读可从 [设计哲学](./guide/philosophy.md) 开始。
