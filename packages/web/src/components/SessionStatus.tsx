import { useEffect, useState } from "react";
import type { SessionStatusDto } from "@typescript-agent-harness/cli";
import { api } from "../api";

/** Read-only session strip for the right rail: cwd, turn, optional workers. */
export function SessionStatus(props: { refreshKey: string | number }) {
  const [status, setStatus] = useState<SessionStatusDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .sessionStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.refreshKey]);

  if (!status) return null;

  const turn =
    status.pending?.kind === "approval"
      ? "待审批"
      : status.pending?.kind === "question"
        ? "待提问"
        : status.busy
          ? "忙碌"
          : "空闲";

  return (
    <div className="rail-card session-status-card">
      <h2>会话</h2>
      <div className="session-status-cwd" title={status.cwd}>
        {status.cwd}
      </div>
      <div className="session-status-turn">
        {status.busy && !status.pending ? <span className="spinner" aria-hidden /> : null}
        <span>{turn}</span>
      </div>
      {status.workers.length > 0 ? (
        <ul className="session-status-workers">
          {status.workers.map((w) => (
            <li key={w.workerId} title={w.workerId}>
              {w.workerId}
              {w.busy ? " · 忙" : ""}
              {w.attention ? ` · ${w.attention}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {status.superAgent ? <div className="session-status-sa">工单 {status.superAgent.ticketCount}</div> : null}
    </div>
  );
}
