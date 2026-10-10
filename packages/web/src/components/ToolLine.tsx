export function ToolLine(props: { tool: string; summary: string; status: "running" | "ok" | "failed"; result: string }) {
  return (
    <div className={`tool ${props.status}`}>
      <span className="dot">⏺</span>
      <span className="name">{props.tool}</span>
      {props.summary ? <span className="summary">{props.summary}</span> : null}
      {props.status === "running" ? <span className="spinner" aria-label="running" /> : null}
      {props.status === "ok" ? <span className="result">✓ {props.result}</span> : null}
      {props.status === "failed" ? <span className="result">✗ {props.result}</span> : null}
    </div>
  );
}
