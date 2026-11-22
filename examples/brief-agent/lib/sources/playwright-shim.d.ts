/** 可选依赖：未安装时 enrich-dp 浏览器升档返回空 HTML。 */
declare module "playwright" {
  export const chromium: {
    launch: (opts?: { headless?: boolean; channel?: string }) => Promise<{
      newPage: () => Promise<{
        goto: (
          url: string,
          opts?: { waitUntil?: string; timeout?: number },
        ) => Promise<unknown>;
        content: () => Promise<string>;
        evaluate: (fn: string | (() => unknown)) => Promise<unknown>;
      }>;
      close: () => Promise<void>;
    }>;
  };
}
