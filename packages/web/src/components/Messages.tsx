import { memo, useEffect, useRef, type ReactNode } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { Entry } from "../state";
import { ToolLine } from "./ToolLine";

/** No raw HTML: replies can echo file contents, and this page can approve commands. */
const Reply = memo(function Reply({ text }: { text: string }) {
  return (
    <div className="reply">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </Markdown>
    </div>
  );
});

const Row = memo(function Row({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "user":
      return <div className="user">{entry.text}</div>;
    case "assistant":
      return <Reply text={entry.text} />;
    case "tool":
      return <ToolLine tool={entry.tool} summary={entry.summary} status={entry.status} result={entry.result} />;
    case "notice":
      return <div className={entry.error ? "notice error" : "notice"}>{entry.text}</div>;
  }
});

/** Follows new output while the reader is at the bottom; leaves them alone once they scroll up. */
export function Messages({ entries, children }: { entries: Entry[]; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });
  return (
    <div
      className="messages"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {entries.map((entry) => (
        <Row key={entry.id} entry={entry} />
      ))}
      {children}
    </div>
  );
}
