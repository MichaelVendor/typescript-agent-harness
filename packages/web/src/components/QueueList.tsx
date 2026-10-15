import type { QueuedMessage } from "@typescript-agent-harness/cli";

/** Messages sent during a turn; paused ones (the turn was stopped or failed) wait for Send. */
export function QueueList(props: { items: QueuedMessage[]; busy: boolean; onSend(id: string): void; onRemove(id: string): void }) {
  if (props.items.length === 0) return null;
  return (
    <div className="queue" aria-label="Queued messages">
      {props.items.map((q) => (
        <div key={q.id} className={`queue-item${q.held ? " held" : ""}`}>
          <span className="queue-text" title={q.text}>
            {q.text || "(attachments)"}
          </span>
          {q.attachments?.length ? (
            <span className="queue-meta">
              {q.attachments.length} file{q.attachments.length > 1 ? "s" : ""}
            </span>
          ) : null}
          {q.held ? (
            <>
              <span className="queue-meta">paused</span>
              <button type="button" disabled={props.busy} onClick={() => props.onSend(q.id)}>
                Send
              </button>
            </>
          ) : (
            <span className="queue-meta">queued</span>
          )}
          <button type="button" className="queue-remove" onClick={() => props.onRemove(q.id)} aria-label="Remove queued message">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
