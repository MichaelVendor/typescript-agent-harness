import { useEffect, useState } from "react";
import type { ReviewPanelSnapshot } from "@typescript-agent-harness/cli";
import { api } from "../api";

function ticketLine(t: { status: string; goal: string }): string {
  const goal = t.goal.length > 48 ? `${t.goal.slice(0, 48)}…` : t.goal;
  return `${t.status}: ${goal}`;
}

/** 右侧栏只读 Super-agent 工单；仅在 `info.superAgentPanel` 时挂载并由父组件轮询触发刷新。 */
export function ReviewTicketsPanel({
  panel,
  onSelectTicket,
}: {
  panel: ReviewPanelSnapshot | null;
  onSelectTicket?: (id: string) => void;
}) {
  if (!panel) {
    return (
      <div className="rail-card">
        <h2>工单</h2>
        等待 Super-agent panel.json…
      </div>
    );
  }
  const needs = panel.needsHuman;
  const running = panel.running;
  const replies = panel.recentReplies.slice(-3);
  return (
    <div className="rail-card">
      <h2>工单</h2>
      <div className="rail-usage">状态 · {panel.status}</div>
      {needs.length ? (
        <>
          <div className="rail-usage" style={{ marginTop: 6 }}>
            待人审 · {needs.length}
          </div>
          {needs.slice(0, 4).map((t) =>
            onSelectTicket ? (
              <button
                key={t.id}
                type="button"
                className="link timeline-rail-ticket"
                title={t.goal}
                onClick={() => onSelectTicket(t.id)}
              >
                {ticketLine(t)}
              </button>
            ) : (
              <div key={t.id} title={t.goal}>
                {ticketLine(t)}
              </div>
            ),
          )}
        </>
      ) : null}
      {running.length ? (
        <>
          <div className="rail-usage" style={{ marginTop: 6 }}>
            进行中 · {running.length}
          </div>
          {running.slice(0, 4).map((t) =>
            onSelectTicket ? (
              <button
                key={t.id}
                type="button"
                className="link timeline-rail-ticket"
                title={t.goal}
                onClick={() => onSelectTicket(t.id)}
              >
                {ticketLine(t)}
              </button>
            ) : (
              <div key={t.id} title={t.goal}>
                {ticketLine(t)}
              </div>
            ),
          )}
        </>
      ) : null}
      {!needs.length && !running.length ? <div>暂无 running / needs_human</div> : null}
      {replies.length ? (
        <>
          <div className="rail-usage" style={{ marginTop: 6 }}>
            最近回复
          </div>
          {replies.map((r, i) => (
            <div key={i} title={r}>
              {r.length > 56 ? `${r.slice(0, 56)}…` : r}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

export type SuperAgentPanelState = {
  panel: ReviewPanelSnapshot | null;
  error?: string;
};

/** Poll `GET /api/super-agent/panel` while enabled. */
export function useSuperAgentPanel(enabled: boolean): SuperAgentPanelState {
  const [panel, setPanel] = useState<ReviewPanelSnapshot | null>(null);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (!enabled) {
      setPanel(null);
      setError(undefined);
      return;
    }
    let cancelled = false;
    const load = () => {
      api
        .superAgentPanel()
        .then((snap) => {
          if (!cancelled) {
            setPanel(snap);
            setError(undefined);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPanel(null);
            setError(err instanceof Error ? err.message : String(err));
          }
        });
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);
  return { panel, error };
}
