import { useEffect, useState } from "react";
import type { FileTarget } from "../preview-view";

export function ToolLine(props: {
  tool: string;
  summary: string;
  status: "running" | "ok" | "failed";
  result: string;
  path?: string;
  /** When true, show the result line even for successful tools. */
  expandAll?: boolean;
  onOpen?(target: FileTarget): void;
}) {
  const { path, onOpen } = props;
  const failed = props.status === "failed";
  const [open, setOpen] = useState(failed);
  useEffect(() => {
    if (props.expandAll) setOpen(true);
    else if (!failed) setOpen(false);
  }, [props.expandAll, failed]);
  const showResult = props.status !== "running" && (open || failed);

  return (
    <div className={`tool ${props.status}`}>
      <button
        type="button"
        className="tool-head"
        aria-expanded={showResult}
        disabled={props.status === "running"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="summary">
          <span className="name">{props.tool}</span>
          {props.summary ? " " : null}
          {props.summary && path && onOpen ? (
            <span
              className="file-link"
              title={path}
              role="link"
              onClick={(e) => {
                e.stopPropagation();
                onOpen({ path });
              }}
            >
              {props.summary}
            </span>
          ) : (
            props.summary
          )}
        </span>
        {props.status === "running" ? <span className="spinner" aria-label="running" /> : null}
        {props.status === "ok" && !showResult ? <span className="result muted">···</span> : null}
        {failed && !open ? <span className="result">✗</span> : null}
      </button>
      {showResult ? <pre className={`tool-detail${failed ? " failed" : ""}`}>{failed ? `✗ ${props.result}` : props.result}</pre> : null}
    </div>
  );
}
