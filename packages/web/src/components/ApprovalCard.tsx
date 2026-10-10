import type { ApprovalAnswer } from "@typescript-agent-harness/cli";
import type { Approval } from "../state";

const PREVIEW_LINES = 8;

function describe(approval: Approval): { title: string; body: string } {
  const a = (approval.input ?? {}) as Record<string, unknown>;
  if (approval.tool === "execute_command") {
    const args = Array.isArray(a.args) ? a.args.map(String) : [];
    return { title: "Run command", body: `$ ${[String(a.program ?? ""), ...args].join(" ")}` };
  }
  if (approval.tool === "write_file") {
    const content = typeof a.content === "string" ? a.content : "";
    const lines = content.split("\n");
    const more = lines.length > PREVIEW_LINES ? `\n… ${lines.length - PREVIEW_LINES} more lines` : "";
    return {
      title: `Write file ${String(a.path ?? "")} (${content.length} chars)`,
      body: lines.slice(0, PREVIEW_LINES).join("\n") + more,
    };
  }
  return { title: `Call ${approval.tool}`, body: JSON.stringify(approval.input, null, 2) };
}

export function ApprovalCard({ approval, onAnswer }: { approval: Approval; onAnswer(answer: ApprovalAnswer): void }) {
  const { title, body } = describe(approval);
  return (
    <div className="card approval" role="dialog" aria-label="approval">
      <div className="card-title">{title}</div>
      <pre className="card-body">{body}</pre>
      <div className="card-actions">
        <button className="primary" onClick={() => onAnswer("yes")}>
          Allow once
        </button>
        <button onClick={() => onAnswer("always")}>Always allow {approval.tool}</button>
        <button className="danger" onClick={() => onAnswer("no")}>
          Reject
        </button>
      </div>
    </div>
  );
}
