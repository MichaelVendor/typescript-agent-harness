export function StatusBar(props: {
  cwd: string | undefined;
  sessionId: string;
  rounds: number;
  tokens: { promptTokens: number; completionTokens: number } | undefined;
  approve: boolean;
  /** Absent while compacting is not possible (a turn runs, or not connected). */
  onCompact: (() => void) | undefined;
  /** Absent when the open folder has no built-in browser. */
  onBrowser: (() => void) | undefined;
}) {
  const tokens =
    props.tokens && props.tokens.promptTokens + props.tokens.completionTokens > 0
      ? `in ${props.tokens.promptTokens.toLocaleString("en-US")} · out ${props.tokens.completionTokens.toLocaleString("en-US")}`
      : undefined;
  const parts = [props.cwd, props.sessionId, `${props.rounds} rounds`, tokens, ...(props.approve ? [] : ["approve=off"])];
  return (
    <div className="status">
      <span>{parts.filter(Boolean).join(" · ")}</span>
      {props.onBrowser ? (
        <button type="button" className="link" onClick={props.onBrowser} title="Open the built-in browser">
          Browser
        </button>
      ) : null}
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
