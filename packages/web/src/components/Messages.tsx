import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { fileRawURL } from "../api";
import { opensInPanel } from "../browser-view";
import { codePath, linkPath, replyImages, type FileTarget } from "../preview-view";
import type { Entry } from "../state";
import { CopyButton } from "./CopyButton";
import { ChevronIcon } from "./Sidebar";
import { ToolLine } from "./ToolLine";

type Open = (target: FileTarget) => void;
type Browse = ((url: string) => void) | undefined;

/** Paths in a reply open in the preview panel; other links and code stay as they are. */
function fileLinks(onOpen: Open, onBrowse: Browse): Components {
  return {
    a({ node: _node, href, children, ...rest }) {
      const file = linkPath(href);
      if (!file) {
        return (
          <a
            href={href}
            {...(href?.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer" })}
            {...rest}
            onClick={(e) => {
              if (!onBrowse || !href || !opensInPanel(href, e, location.origin)) return;
              e.preventDefault();
              onBrowse(href);
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a
          href={href}
          className="file-link"
          onClick={(e) => {
            e.preventDefault();
            onOpen({ path: file });
          }}
        >
          {children}
        </a>
      );
    },
    pre({ children }) {
      return <CodeFence>{children}</CodeFence>;
    },
    code({ node: _node, children, ...rest }) {
      const file = typeof children === "string" && !children.includes("\n") ? codePath(children) : null;
      if (!file) return <code {...rest}>{children}</code>;
      return (
        <code
          {...rest}
          className="file-link"
          role="button"
          tabIndex={0}
          title={`Open ${file}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen({ path: file });
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.stopPropagation();
            onOpen({ path: file });
          }}
        >
          {children}
        </code>
      );
    },
  };
}

/** A fenced code block, with a button that copies the text as shown. */
function CodeFence({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <CopyButton text={() => ref.current?.innerText ?? ""} />
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

function ReplyImage({ file, onOpen }: { file: string; onOpen: Open }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <button type="button" className="reply-image" title={file} onClick={() => onOpen({ path: file })}>
      <img src={fileRawURL({ path: file }, 0)} alt="" onError={() => setFailed(true)} />
    </button>
  );
}

/** No raw HTML: replies can echo file contents, and this page can approve commands. */
const Reply = memo(function Reply({ text, onOpen, onBrowse }: { text: string; onOpen: Open; onBrowse: Browse }) {
  const components = useMemo(() => fileLinks(onOpen, onBrowse), [onOpen, onBrowse]);
  const images = useMemo(() => replyImages(text), [text]);
  return (
    <div className="reply">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {text}
      </Markdown>
      {images.length ? (
        <div className="reply-images">
          {images.map((file) => (
            <ReplyImage key={file} file={file} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
    </div>
  );
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const Row = memo(function Row({ entry, onOpen, onBrowse }: { entry: Entry; onOpen: Open; onBrowse: Browse }) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="user">
          {entry.attachments?.length ? (
            <div className="user-attach">
              {entry.attachments.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className={`attach-card sent ${a.kind}`}
                  title={a.name}
                  onClick={() => onOpen({ attachment: a.id, name: a.name })}
                >
                  {a.kind === "image" ? (
                    <img src={fileRawURL({ attachment: a.id }, 0)} alt="" loading="lazy" />
                  ) : (
                    <span className="attach-ext">{a.name.split(".").pop()?.toUpperCase() ?? "FILE"}</span>
                  )}
                  <span className="attach-meta">
                    <span className="attach-name">{a.name}</span>
                    <span className="attach-sub">{formatSize(a.bytes)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {entry.text ? (
            <div>{entry.text}</div>
          ) : entry.attachments?.length ? (
            <div className="user-attach-fallback">Attached</div>
          ) : (
            <div className="user-attach-fallback">(empty)</div>
          )}
        </div>
      );
    case "assistant":
      return <Reply text={entry.text} onOpen={onOpen} onBrowse={onBrowse} />;
    case "tool":
      return (
        <ToolLine
          tool={entry.tool}
          summary={entry.summary}
          status={entry.status}
          result={entry.result}
          {...(entry.path ? { path: entry.path } : {})}
          onOpen={onOpen}
        />
      );
    case "notice":
      return <div className={entry.error ? "notice error" : "notice"}>{entry.text}</div>;
  }
});

type Item = { kind: "row"; entry: Entry } | { kind: "steps"; id: number; entries: Entry[] };

const isCtx = (e: Entry) => e.kind === "notice" && !e.error && e.text.startsWith("[ctx]");

/** Runs of tool calls (and the context-trim notices between them) become one collapsible block. */
function group(entries: Entry[]): Item[] {
  const items: Item[] = [];
  for (const entry of entries) {
    const last = items.at(-1);
    if (entry.kind === "tool" || isCtx(entry)) {
      if (last?.kind === "steps") last.entries.push(entry);
      else items.push({ kind: "steps", id: entry.id, entries: [entry] });
    } else {
      items.push({ kind: "row", entry });
    }
  }
  return items;
}

/** While live, shows the latest few steps; once the turn moves on, collapses to one summary line. */
function Steps({ entries, live, onOpen, onBrowse }: { entries: Entry[]; live: boolean; onOpen: Open; onBrowse: Browse }) {
  const [open, setOpen] = useState(false);
  const tools = entries.filter((e) => e.kind === "tool");
  if (!tools.length) return entries.map((e) => <Row key={e.id} entry={e} onOpen={onOpen} onBrowse={onBrowse} />);

  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.tool, (counts.get(t.tool) ?? 0) + 1);
  const detail = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(" · ");
  const failed = tools.filter((t) => t.status === "failed").length;
  const shown = open ? entries : live ? tools.slice(-3) : [];

  return (
    <div className="steps">
      <button type="button" className="steps-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon open={open} />
        {live ? <span className="spinner" aria-label="running" /> : null}
        <span className="steps-title">
          {live ? "Working" : "Ran"} {tools.length} {tools.length === 1 ? "step" : "steps"}
        </span>
        <span className="steps-detail">{detail}</span>
        {failed ? <span className="steps-failed">{failed} failed</span> : null}
      </button>
      {shown.length ? (
        <div className="steps-body">
          {shown.map((e) => (
            <Row key={e.id} entry={e} onOpen={onOpen} onBrowse={onBrowse} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Follows new output while the reader is at the bottom; leaves them alone once they scroll up. */
export function Messages({
  entries,
  busy,
  onOpen,
  onBrowse,
  children,
}: {
  entries: Entry[];
  busy: boolean;
  onOpen: Open;
  onBrowse: Browse;
  children?: ReactNode;
}) {
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
      {entries.length === 0 ? (
        <div className="empty">
          <div className="empty-title">New chat</div>
          <p className="empty-hint">
            Ask the agent anything below. Attach files with +, or drop / paste into the composer.
          </p>
        </div>
      ) : null}
      {group(entries).map((item, i, items) =>
        item.kind === "row" ? (
          <Row key={item.entry.id} entry={item.entry} onOpen={onOpen} onBrowse={onBrowse} />
        ) : (
          <Steps key={item.id} entries={item.entries} live={busy && i === items.length - 1} onOpen={onOpen} onBrowse={onBrowse} />
        ),
      )}
      {children}
    </div>
  );
}
