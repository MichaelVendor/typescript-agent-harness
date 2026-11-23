import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewPanelSnapshot } from "@typescript-agent-harness/cli";

type Ticket = ReviewPanelSnapshot["tickets"][number];
import { groupTicketsForTimeline, type TimelineGroupId } from "../timeline";

const GROUP_TITLE: Record<TimelineGroupId, string> = {
  needs_human: "待人审",
  running: "进行中",
  queued: "排队",
  done: "完成",
  failed: "失败",
};

const STATUS_LABEL: Record<TimelineGroupId, string> = GROUP_TITLE;

function truncateGoal(goal: string, max = 56): string {
  return goal.length > max ? `${goal.slice(0, max)}…` : goal;
}

function formatTs(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type TimelineViewProps = {
  panel?: ReviewPanelSnapshot | null;
  tickets?: Ticket[];
  error?: string;
  highlightId?: string | null;
  onHighlightConsumed?: () => void;
};

export function TimelineView({
  panel,
  tickets: ticketsProp,
  error,
  highlightId,
  onHighlightConsumed,
}: TimelineViewProps) {
  const tickets = ticketsProp ?? panel?.tickets ?? [];
  const grouped = useMemo(() => groupTicketsForTimeline(tickets), [tickets]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    if (!highlightId) return;
    setExpanded((prev) => new Set(prev).add(highlightId));
    setFlashId(highlightId);
    const el = rowRefs.current.get(highlightId);
    requestAnimationFrame(() => {
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    const timer = window.setTimeout(() => {
      setFlashId(null);
      onHighlightConsumed?.();
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [highlightId, onHighlightConsumed]);

  if (error) {
    return (
      <div className="timeline-view">
        <p className="timeline-empty">工单面板加载失败：{error}</p>
      </div>
    );
  }

  const panelMode = ticketsProp === undefined;
  if (panelMode && !error && panel === null) {
    return (
      <div className="timeline-view">
        <p className="timeline-empty">等待 Super-agent panel.json…</p>
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="timeline-view">
        <p className="timeline-empty">暂无工单</p>
      </div>
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="timeline-view">
      {grouped.map((group) => (
        <section key={group.id} className="timeline-group">
          <h3 className="timeline-group-title">
            {GROUP_TITLE[group.id]} · {group.tickets.length}
          </h3>
          <ul className="timeline-list">
            {group.tickets.map((t) => {
              const full = tickets.find((x) => x.id === t.id);
              const open = expanded.has(t.id);
              const status = t.status as TimelineGroupId;
              return (
                <li key={t.id}>
                  <div
                    ref={(node) => {
                      rowRefs.current.set(t.id, node);
                    }}
                    className={flashId === t.id ? "timeline-row timeline-row-flash" : "timeline-row"}
                  >
                    <button type="button" className="timeline-row-head" onClick={() => toggle(t.id)}>
                      <span className="badge timeline-status">{STATUS_LABEL[status] ?? t.status}</span>
                      <span className="timeline-goal" title={t.goal}>
                        {truncateGoal(t.goal)}
                      </span>
                      <span className="timeline-chevron" aria-hidden>
                        {open ? "▾" : "▸"}
                      </span>
                    </button>
                    {open && full ? (
                      <div className="timeline-detail">
                        <div>
                          <strong>目标</strong>
                          <p>{full.goal}</p>
                        </div>
                        <div className="timeline-meta">
                          <span>创建 · {formatTs(full.createdAt)}</span>
                          {full.startedAt ? <span>开始 · {formatTs(full.startedAt)}</span> : null}
                        </div>
                        {full.lastReport ? (
                          <div>
                            <strong>最近汇报</strong>
                            <pre className="timeline-pre">{full.lastReport}</pre>
                          </div>
                        ) : null}
                        {full.failReason ? (
                          <div>
                            <strong>失败原因</strong>
                            <pre className="timeline-pre">{full.failReason}</pre>
                          </div>
                        ) : null}
                        {full.threadId ? (
                          <div>
                            <strong>threadId</strong>
                            <code className="timeline-code">{full.threadId}</code>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}