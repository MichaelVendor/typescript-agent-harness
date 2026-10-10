import { useLayoutEffect, useRef, useState } from "react";

export function Composer(props: { busy: boolean; disabled: boolean; onSend(text: string): void; onStop(): void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const send = () => {
    if (props.busy || props.disabled || !text.trim()) return;
    props.onSend(text);
    setText("");
  };

  return (
    <div className="composer">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder="Message the agent — Enter to send, Shift+Enter for a new line"
        disabled={props.disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // While an input method is composing, Enter picks a candidate instead of sending.
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          send();
        }}
      />
      {props.busy ? (
        <button className="danger" onClick={props.onStop}>
          Stop
        </button>
      ) : (
        <button className="primary" onClick={send} disabled={props.disabled || !text.trim()}>
          Send
        </button>
      )}
    </div>
  );
}
