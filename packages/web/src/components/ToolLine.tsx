import type { FileTarget } from "../preview-view";

export function ToolLine(props: {
  tool: string;
  summary: string;
  status: "running" | "ok" | "failed";
  result: string;
  path?: string;
  onOpen?(target: FileTarget): void;
}) {
  const { path, onOpen } = props;
  return (
    <div className={`tool ${props.status}`}>
      <span className="dot">⏺</span>
      <span className="name">{props.tool}</span>
      {props.summary && path && onOpen ? (
        <button type="button" className="summary file-link" title={path} onClick={() => onOpen({ path })}>
          {props.summary}
        </button>
      ) : props.summary ? (
        <span className="summary">{props.summary}</span>
      ) : null}
      {props.status === "running" ? <span className="spinner" aria-label="running" /> : null}
      {props.status === "ok" ? <span className="result">✓ {props.result}</span> : null}
      {props.status === "failed" ? <span className="result">✗ {props.result}</span> : null}
    </div>
  );
}
