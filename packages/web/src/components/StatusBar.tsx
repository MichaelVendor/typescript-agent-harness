export function StatusBar(props: { model: string | undefined; sessionId: string; rounds: number; approve: boolean }) {
  const parts = [props.model ?? "tah", props.sessionId, `${props.rounds} rounds`, ...(props.approve ? [] : ["approve=off"])];
  return <div className="status">{parts.filter(Boolean).join(" · ")}</div>;
}
