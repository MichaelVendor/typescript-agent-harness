import { useEffect, useState } from "react";
import { label, type Item } from "../sidebar-view";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));
const MAX = 2000;

export function SendToSession(props: {
  from: Item;
  busy: boolean;
  onClose(): void;
  onSend(toSessionId: string, text: string): Promise<void>;
}) {
  const targets = props.from.ws.sessions.filter((s) => !s.archived && s.id !== props.from.session.id);
  const [toId, setToId] = useState(targets[0]?.id ?? "");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  const send = async () => {
    const trimmed = body.trim();
    if (!toId || !trimmed) {
      setError(!toId ? "Pick a session" : "Message is empty");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await props.onSend(toId, trimmed);
      props.onClose();
    } catch (err) {
      setPending(false);
      setError(text(err));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-label="Send to session">
        <div className="modal-title">Send to session</div>
        <div className="sidebar-note">From {label(props.from.session)}</div>
        {targets.length ? (
          <ul className="dirs recent">
            {targets.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  title={s.id}
                  className={toId === s.id ? "on" : undefined}
                  disabled={props.busy || pending}
                  onClick={() => setToId(s.id)}
                >
                  {label(s)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="sidebar-note">No other sessions in this workspace.</div>
        )}
        <textarea
          className="send-to-session-text"
          rows={4}
          maxLength={MAX}
          placeholder="Short note for the other session…"
          aria-label="Message"
          value={body}
          disabled={props.busy || pending || !targets.length}
          onChange={(e) => setBody(e.target.value)}
        />
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="card-actions">
          <button
            type="button"
            className="primary"
            disabled={props.busy || pending || !targets.length}
            onClick={() => void send()}
          >
            Send
          </button>
          <span className="spacer" />
          <button type="button" disabled={pending} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}