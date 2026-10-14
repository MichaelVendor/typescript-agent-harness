import type { BrowserInput, BrowserState } from "@typescript-agent-harness/cli";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { api, browserStream } from "../api";
import { addressURL, keyInput, modifiers, mouseButton, toPage } from "../browser-view";

/** Mouse moves and wheel turns go out at most this often. */
const THROTTLE_MS = 30;

type Frame = { src: string; width: number; height: number };

/** The built-in browser's live page: watch the agent, or click and type in it yourself. */
export function BrowserPane(props: { agentBusy: boolean; onClose(): void }) {
  const [state, setState] = useState<BrowserState>();
  const [frame, setFrame] = useState<Frame>();
  const [address, setAddress] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const image = useRef<HTMLImageElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastMove = useRef(0);
  const wheel = useRef<{ x: number; y: number; dx: number; dy: number; modifiers: number } | undefined>(undefined);
  const composing = useRef(false);

  useEffect(
    () =>
      browserStream((event) => {
        if (event.type === "frame") {
          setFrame({ src: `data:image/jpeg;base64,${event.data}`, width: event.width, height: event.height });
          return;
        }
        setState(event.state);
        if (!event.state.running) setFrame(undefined);
      }),
    [],
  );

  const run = (pending: Promise<unknown>) => {
    setFailed(undefined);
    pending.catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)));
  };
  /** One at a time, so a click's press and release reach the page in order. */
  const send = (input: BrowserInput) => {
    queue.current = queue.current.then(() => api.browserInput(input)).catch(() => {});
  };

  const tab = state?.tabs.find((t) => t.id === state.active);
  const shown = address ?? tab?.url ?? "";

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = image.current?.getBoundingClientRect();
    if (!rect || !frame) return undefined;
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return undefined;
    return toPage(e.clientX, e.clientY, rect, frame);
  };
  const press = (e: ReactMouseEvent, event: "down" | "up") => {
    const p = point(e);
    if (p) send({ type: "mouse", event, ...p, button: mouseButton(e.button), clickCount: Math.max(e.detail, 1), modifiers: modifiers(e) });
  };
  const move = (e: ReactMouseEvent) => {
    if (Date.now() - lastMove.current < THROTTLE_MS) return;
    const p = point(e);
    if (!p) return;
    lastMove.current = Date.now();
    send({ type: "mouse", event: "move", ...p, button: e.buttons & 1 ? "left" : "none", clickCount: 0, modifiers: modifiers(e) });
  };
  const turn = (e: ReactWheelEvent) => {
    const pending = wheel.current;
    if (pending) {
      pending.dx += e.deltaX;
      pending.dy += e.deltaY;
      return;
    }
    const p = point(e);
    if (!p) return;
    wheel.current = { ...p, dx: e.deltaX, dy: e.deltaY, modifiers: modifiers(e) };
    setTimeout(() => {
      const w = wheel.current;
      wheel.current = undefined;
      if (w) send({ type: "wheel", ...w });
    }, THROTTLE_MS);
  };
  const key = (e: ReactKeyboardEvent, event: "down" | "up") => {
    const input = keyInput(
      {
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing || composing.current,
      },
      event,
    );
    if (!input) return;
    e.preventDefault();
    send(input);
  };
  const typed = () => {
    const el = keys.current;
    if (!el?.value) return;
    send({ type: "text", text: el.value });
    el.value = "";
  };

  return (
    <>
      <div className="preview-head browser-head">
        <button type="button" disabled={!state?.running} onClick={() => run(api.browserNav({ action: "back" }))} aria-label="Back" title="Back">
          ←
        </button>
        <button type="button" disabled={!state?.running} onClick={() => run(api.browserNav({ action: "reload" }))} aria-label="Reload" title="Reload">
          ↻
        </button>
        <form
          className="browser-address"
          onSubmit={(e) => {
            e.preventDefault();
            const url = addressURL(shown);
            if (!url) return;
            setAddress(undefined);
            run(api.browserOpen({ url }));
          }}
        >
          <input
            value={shown}
            placeholder="Enter a URL"
            spellCheck={false}
            aria-label="Address"
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => setAddress(undefined)}
          />
        </form>
        {state && state.tabs.length > 1 ? (
          <select value={state.active ?? ""} aria-label="Tabs" onChange={(e) => run(api.browserTab({ id: e.target.value }))}>
            {state.tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title || t.url}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          disabled={!tab || !/^https?:/.test(tab.url)}
          onClick={() => tab && window.open(tab.url, "_blank", "noreferrer")}
          aria-label="Open in system browser"
          title="Open in system browser"
        >
          ↗
        </button>
        <button
          type="button"
          disabled={!state?.running}
          onClick={() => {
            if (state?.agent && !window.confirm("The agent is using this browser. Close it anyway?")) return;
            run(api.browserClose());
          }}
          aria-label="Close browser"
          title="Close browser"
        >
          ⏻
        </button>
        <button type="button" onClick={props.onClose} aria-label="Hide" title="Hide">
          ✕
        </button>
      </div>
      {props.agentBusy ? <div className="browser-agent">Agent is using the browser</div> : null}
      {failed || state?.error ? <div className="preview-note browser-error">{failed ?? state?.error}</div> : null}
      <div className="browser-screen">
        {state?.running && frame ? (
          <div className="browser-frame">
            <img ref={image} src={frame.src} alt={tab?.title || "Page"} draggable={false} />
            <textarea
              ref={keys}
              className="browser-keys"
              aria-label="Type into the page"
              spellCheck={false}
              onMouseDown={(e) => press(e, "down")}
              onMouseUp={(e) => press(e, "up")}
              onMouseMove={move}
              onWheel={turn}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => key(e, "down")}
              onKeyUp={(e) => key(e, "up")}
              onInput={() => {
                if (!composing.current) typed();
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
                typed();
              }}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData("text/plain");
                if (text) send({ type: "text", text });
              }}
            />
          </div>
        ) : (
          <div className="preview-empty">
            {state && !state.running ? "Enter a URL above to open the browser" : <span className="spinner" />}
          </div>
        )}
      </div>
    </>
  );
}
