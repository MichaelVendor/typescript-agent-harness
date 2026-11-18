/**
 * Super-agent 外部 Source 适配（S3）：mock GitHub Issue / PR 评论 → SuperAgentEvent。
 * 真实 GitHub webhook 可后接同一 toSourceEvent 形状。
 */
import type { SuperAgentEvent, ThreadId } from "./super-agent.js";

export type MockGitHubComment = {
  /** 用作 threadId，如 "issue:42" / "pr:7" */
  threadId: ThreadId;
  /** 评论正文 */
  body: string;
  author?: string;
  /** issue | pull_request */
  kind?: "issue" | "pull_request";
};

export type MockGitHubSource = {
  /** 将一条评论变成 source_event */
  toSourceEvent(comment: MockGitHubComment): SuperAgentEvent;
  /** 批量 ingest 用：返回事件列表 */
  drain(comments: MockGitHubComment[]): SuperAgentEvent[];
};

/**
 * 创建 mock GitHub Source。不发真实 HTTP；仅做事件形状转换。
 */
export function createMockGitHubSource(options?: {
  sourceName?: string;
}): MockGitHubSource {
  const source = options?.sourceName ?? "github";
  return {
    toSourceEvent(comment) {
      const who = comment.author ? `@${comment.author}: ` : "";
      const kind = comment.kind ?? "issue";
      return {
        kind: "source_event",
        source,
        threadId: comment.threadId,
        text: `[${kind}] ${who}${comment.body}`,
      };
    },
    drain(comments) {
      return comments.map((c) => this.toSourceEvent(c));
    },
  };
}
