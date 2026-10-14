import type { FileStat } from "@typescript-agent-harness/cli";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { api, ApiError, fileRawURL } from "../api";
import { codeBlock, fileQuery, relativeTo, type FileTarget } from "../preview-view";

const WIDTH = "tah.previewWidth";
const TEXT_LIMIT = 1024 * 1024;
const HIGHLIGHT_LIMIT = 256 * 1024;
/** Same as the server's `/preview` CSP; never add allow-same-origin (the page could then use the sign-in cookie). */
const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const textual = (stat: FileStat, source: boolean) =>
  stat.kind === "markdown" || stat.kind === "text" || (stat.kind === "html" && source);

/** Read-only preview of one file in the open folder; `version` bumps when a tool may have changed files. */
export function FilePreview(props: {
  target: FileTarget;
  version: number;
  onOpen(target: FileTarget): void;
  onClose(): void;
}) {
  const { target, version, onOpen, onClose } = props;
  const key = fileQuery(target);
  const [stat, setStat] = useState<FileStat>();
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const [source, setSource] = useState(false);
  const [text, setText] = useState<string>();
  const [width, setWidth] = useState(() =>
    Math.min(Math.max(Number(localStorage.getItem(WIDTH)) || 480, 280), window.innerWidth - 360),
  );
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api.fileStat(target).then(
      (next) => {
        if (!live) return;
        setGone(false);
        setFailed(undefined);
        setStat((prev) => (prev && prev.path === next.path && prev.mtime === next.mtime ? prev : next));
      },
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 404) setGone(true);
        else setFailed(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      live = false;
    };
    // `target` is identified by `key`.
  }, [key, version, nonce]);

  const wantsText = stat ? textual(stat, source) : false;
  useEffect(() => {
    setText(undefined);
    if (!stat || !wantsText) return;
    if (stat.bytes === 0) {
      setText("");
      return;
    }
    let live = true;
    api.fileText(target, stat.mtime, TEXT_LIMIT).then(
      (body) => live && setText(body),
      (err: unknown) => live && setFailed(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [stat, wantsText, nonce]);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = Math.min(Math.max(drag.current.width + drag.current.x - e.clientX, 280), window.innerWidth - 360);
    setWidth(next);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = undefined;
    localStorage.setItem(WIDTH, String(width));
  };

  const title = stat?.path ?? ("path" in target ? target.path : "attachment");
  return (
    <aside className="file-preview" style={{ width }}>
      <div className="preview-resize" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} />
      <div className="preview-head">
        <span className="preview-title" title={title}>
          {title}
        </span>
        {stat?.kind === "html" ? (
          <button type="button" onClick={() => setSource(!source)}>
            {source ? "Rendered" : "Source"}
          </button>
        ) : null}
        <button type="button" onClick={() => setNonce(nonce + 1)} aria-label="Refresh">
          ↻
        </button>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="preview-body">
        {gone ? (
          <div className="preview-empty">{stat ? "This file was deleted" : "Not found in this folder"}</div>
        ) : failed ? (
          <div className="preview-empty">Could not load: {failed}</div>
        ) : !stat ? (
          <div className="preview-empty">
            <span className="spinner" />
          </div>
        ) : (
          <Body key={nonce} stat={stat} target={target} source={source} text={text} onOpen={onOpen} />
        )}
      </div>
    </aside>
  );
}

function Body(props: { stat: FileStat; target: FileTarget; source: boolean; text: string | undefined; onOpen(target: FileTarget): void }) {
  const { stat, target, source, text, onOpen } = props;
  const raw = fileRawURL(target, stat.mtime);
  if (stat.kind === "image") return <img className="preview-image" src={raw} alt={stat.path} />;
  if (stat.kind === "pdf") return <iframe className="preview-frame" src={raw} title={stat.path} />;
  if (stat.kind === "video") return <video className="preview-video" src={raw} controls />;
  if (stat.kind === "html" && !source && stat.previewURL) {
    return <iframe className="preview-frame" src={`${stat.previewURL}?v=${stat.mtime}`} sandbox={SANDBOX} title={stat.path} />;
  }
  if (stat.kind === "binary") return <div className="preview-empty">No preview for this file · {formatSize(stat.bytes)}</div>;
  if (text === undefined) {
    return (
      <div className="preview-empty">
        <span className="spinner" />
      </div>
    );
  }
  const cut = stat.bytes > TEXT_LIMIT ? <div className="preview-note">File too large — showing the first 1 MB</div> : null;
  if (stat.kind === "markdown" && !source) {
    return (
      <div className="reply preview-markdown">
        {cut}
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={inFile(stat, onOpen)}>
          {text}
        </Markdown>
      </div>
    );
  }
  if (text.length > HIGHLIGHT_LIMIT) {
    return (
      <>
        {cut}
        <pre className="preview-text">{text}</pre>
      </>
    );
  }
  return (
    <div className="reply preview-code">
      {cut}
      <Markdown rehypePlugins={[rehypeHighlight]}>{codeBlock(text, stat.path)}</Markdown>
    </div>
  );
}

/** Inside a previewed Markdown file: relative images load from the folder, relative links open here, web links in a new tab. */
function inFile(stat: FileStat, onOpen: (target: FileTarget) => void): Components {
  return {
    img({ node: _node, src, alt }) {
      const file = typeof src === "string" ? relativeTo(stat.path, src) : null;
      return <img src={file ? fileRawURL({ path: file }, stat.mtime) : src} alt={alt ?? ""} />;
    },
    a({ node: _node, href, children }) {
      const file = href ? relativeTo(stat.path, href) : null;
      if (file) {
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
      }
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
  };
}
