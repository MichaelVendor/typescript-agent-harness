export function StatusBar(props: {
  cwd: string | undefined;
  model: string | undefined;
  sessionId: string;
  rounds: number;
  approve: boolean;
  /** Absent while compacting is not possible (a turn runs, or not connected). */
  onCompact: (() => void) | undefined;
}) {
  const parts = [props.cwd, props.model ?? "tah", props.sessionId, `${props.rounds} rounds`, ...(props.approve ? [] : ["approve=off"])];
  return (
    <div className="status">
      <span>{parts.filter(Boolean).join(" · ")}</span>
      <button
        type="button"
        className="link"
        disabled={!props.onCompact}
        onClick={props.onCompact}
        title="Summarize the conversation so far to free up context"
      >
        Compact
      </button>
    </div>
  );
}
