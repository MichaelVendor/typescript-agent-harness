import type { TeamMember } from "@typescript-agent-harness/cli";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type RoomSnapshot } from "../api";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

const KIND_LABEL: Record<string, string> = {
  chat: "chat",
  delegate: "delegate",
  result: "result",
  status: "status",
  error: "error",
};

function memberLabel(members: TeamMember[], from: string): string {
  if (from === "user") return "You";
  if (from === "system") return "System";
  const m = members.find((x) => x.id === from);
  return m?.displayName ?? from;
}

export function RoomView(props: { disabled?: boolean }) {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [showGoal, setShowGoal] = useState(false);
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const locked = props.disabled || pending;

  const load = useCallback(() => {
    void api.roomGet().then(setSnap, (err: unknown) => {
      if (err instanceof ApiError && err.status === 404) setError("Room not enabled on this server.");
      else setError(text(err));
    });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [snap?.messages.length]);

  const members = snap?.meta.members ?? [];

  const nameOf = useCallback((from: string) => memberLabel(members, from), [members]);

  const run = async (action: () => Promise<RoomSnapshot | void>) => {
    setPending(true);
    setError(undefined);
    try {
      const next = await action();
      if (next) setSnap(next);
    } catch (err) {
      setError(text(err));
    } finally {
      setPending(false);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void run(async () => api.roomMessage({ text }));
  };

  const step = () => void run(async () => api.roomStep());

  const newGoal = () => {
    const text = goalDraft.trim();
    if (!text) return;
    setGoalDraft("");
    setShowGoal(false);
    void run(async () => api.roomGoal({ text }));
  };

  if (!snap && !error) {
    return (
      <div className="room-view">
        <p className="room-empty">Loading room…</p>
      </div>
    );
  }

  const meta = snap?.meta;
  const status = meta?.status ?? "—";
  const active = meta?.activeMember;
  const goal = meta?.goal?.trim();

  return (
    <div className="room-view">
      <aside className="room-rail session-rail">
        <div className="rail-card">
          <h2>Members</h2>
          <ul className="room-member-list">
            {members.map((m) => (
              <li key={m.id} className={m.id === active ? "room-member on" : "room-member"}>
                <span className="room-member-name">{m.displayName}</span>
                <span className="room-member-id">{m.id}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rail-card">
          <h2>Goal</h2>
          <p className="room-goal">{goal || "—"}</p>
        </div>
      </aside>
      <section className="room-main">
        <div className="room-status" aria-live="polite">
          <span className="room-status-pill">{status}</span>
          {active ? <span className="room-status-active">active: {nameOf(active)}</span> : null}
        </div>
        <div className="room-transcript">
          {(snap?.messages ?? []).map((msg) => (
            <article key={msg.id} className={`room-msg kind-${msg.kind}`}>
              <header className="room-msg-head">
                <span className="room-msg-from">{nameOf(msg.from)}</span>
                <span className="room-msg-kind">{KIND_LABEL[msg.kind] ?? msg.kind}</span>
                <time className="room-msg-at" dateTime={msg.at}>
                  {new Date(msg.at).toLocaleTimeString()}
                </time>
              </header>
              <div className="room-msg-text">{msg.text}</div>
            </article>
          ))}
          <div ref={bottomRef} />
        </div>
        {error ? <div className="modal-error room-error">{error}</div> : null}
        {showGoal ? (
          <div className="room-goal-form">
            <input
              value={goalDraft}
              placeholder="New goal…"
              disabled={locked}
              onChange={(e) => setGoalDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  newGoal();
                }
                if (e.key === "Escape") setShowGoal(false);
              }}
            />
            <button type="button" className="primary" disabled={locked || !goalDraft.trim()} onClick={newGoal}>
              Start
            </button>
            <button type="button" disabled={locked} onClick={() => setShowGoal(false)}>
              Cancel
            </button>
          </div>
        ) : null}
        <footer className="room-composer">
          <textarea
            rows={2}
            value={draft}
            placeholder="Message the team…"
            disabled={locked}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="room-actions">
            <button type="button" className="primary" disabled={locked || !draft.trim()} onClick={send}>
              Send
            </button>
            <button type="button" disabled={locked} onClick={step}>
              Step
            </button>
            <button type="button" disabled={locked} onClick={() => setShowGoal(true)}>
              New goal
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}