import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { fileRawURL } from "../api";
import { opensInPanel } from "../browser-view";
import { codePath, linkPath, markdownImagePath, replyImages, type FileTarget } from "../preview-view";
import type { Entry } from "../state";
import { CopyButton } from "./CopyButton";
import { ToolLine } from "./ToolLine";

type Open = (target: FileTarget) => void;
type Browse = ((url: string) => void) | undefined;

/** Paths in a reply open in the preview panel; other links and code stay as they are. */
function fileLinks(onOpen: Open, onBrowse: Browse): Components {
  return {
    img({ node: _node, src, alt }) {
      const file = markdownImagePath(src);
      if (!file) {
        return <img src={src} alt={alt ?? ""} />;
      }
      return (
        <button type="button" className="reply-image" title={file} onClick={() => onOpen({ path: file })}>
          <img src={fileRawURL({ path: file }, 0)} alt={alt ?? ""} />
        </button>
      );
    },
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

const Row = memo(function Row({
  entry,
  onOpen,
  onBrowse,
  expandTools,
}: {
  entry: Entry;
  onOpen: Open;
  onBrowse: Browse;
  expandTools: boolean;
}) {
  switch (entry.kind) {
    case "user": {
      const attachments = entry.attachments ?? [];
      const images = attachments.filter((a) => a.kind === "image");
      const files = attachments.filter((a) => a.kind !== "image");
      // Claude Code TUI: inverse bar wraps user text; images sit outside that bar.
      return (
        <div className="user">
          {images.length ? (
            <div className="user-attach">
              {images.map((a, i) => (
                <button
                  type="button"
                  key={a.id}
                  className="image-chip sent"
                  title={a.name}
                  onClick={() => onOpen({ attachment: a.id, name: a.name })}
                >
                  <img src={fileRawURL({ attachment: a.id }, 0)} alt="" loading="lazy" />
                  <span className="image-chip-label">{`[Image #${i + 1}]`}</span>
                </button>
              ))}
            </div>
          ) : null}
          {files.length ? (
            <div className="user-attach">
              {files.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className="image-chip sent file"
                  title={a.name}
                  onClick={() => onOpen({ attachment: a.id, name: a.name })}
                >
                  <span className="image-chip-label">{a.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          {entry.text ? <div className="user-bar">{entry.text}</div> : null}
          {!entry.text && attachments.length === 0 ? <div className="user-attach-fallback">(empty)</div> : null}
        </div>
      );
    }
    case "assistant":
      return <Reply text={entry.text} onOpen={onOpen} onBrowse={onBrowse} />;
    case "tool":
      return (
        <ToolLine
          tool={entry.tool}
          summary={entry.summary}
          status={entry.status}
          result={entry.result}
          expandAll={expandTools}
          {...(entry.path ? { path: entry.path } : {})}
          onOpen={onOpen}
        />
      );
    case "notice":
      return <div className={entry.error ? "notice error" : "notice"}>{entry.text}</div>;
  }
});

/** Follows new output while the reader is at the bottom; leaves them alone once they scroll up. */
export function Messages({
  entries,
  onOpen,
  onBrowse,
  expandTools = false,
  children,
}: {
  entries: Entry[];
  busy: boolean;
  onOpen: Open;
  onBrowse: Browse;
  /** Ctrl+O: expand every finished tool's result. */
  expandTools?: boolean;
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
      {entries.map((entry) => (
        <Row key={entry.id} entry={entry} onOpen={onOpen} onBrowse={onBrowse} expandTools={expandTools} />
      ))}
      {children}
    </div>
  );
}
