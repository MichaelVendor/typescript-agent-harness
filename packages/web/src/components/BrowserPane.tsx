import type { BrowserInput, BrowserState } from "@typescript-agent-harness/cli";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { api, browserStream } from "../api";
import { addressURL, keyInput, modifiers, mouseButton, toPage } from "../browser-view";

/** Mouse moves and wheel turns go out at most this often. */
const THROTTLE_MS = 30;

type Frame = { src: string; width: number; height: number };

function IconBtn(props: {
  label: string;
  title?: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="browser-icon"
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props.label}
      title={props.title ?? props.label}
    >
      {props.children}
    </button>
  );
}

const BackIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ForwardIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ReloadIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M13 8a5 5 0 1 1-1.4-3.4" strokeLinecap="round" />
    <path d="M13 3v3.5H9.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ExternalIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M6.5 3.5H3.5v9h9V9.5M9 3.5h3.5V7M7.5 8.5 12.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PowerIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M8 2.5v5.5M4.2 4.4a5 5 0 1 0 7.6 0" strokeLinecap="round" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M4 4l8 8M12 4 4 12" strokeLinecap="round" />
  </svg>
);

/** The built-in browser's live page: watch the agent, or click and type in it yourself. */
export function BrowserPane(props: { agentBusy: boolean; onClose(): void }) {
  const [state, setState] = useState<BrowserState>();
  const [frame, setFrame] = useState<Frame>();
  const [address, setAddress] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const screenEl = useRef<HTMLDivElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const moving = useRef<BrowserInput | undefined>(undefined);
  const wheel = useRef<{ x: number; y: number; dx: number; dy: number; modifiers: number } | undefined>(undefined);
  const composing = useRef(false);
  /** The button pressed on the frame; until it is released, moves and the release outside the frame count at its edge. */
  const held = useRef<number | undefined>(undefined);

  useEffect(
    () =>
      browserStream((event) => {
        if (event.type === "frame") {
          setFrame({ src: `data:image/jpeg;base64,${event.data}`, width: event.width, height: event.height });
          setLoading(false);
          return;
        }
        setState(event.state);
        if (event.state.running) return;
        setFrame(undefined);
        setLoading(false);
        setClosing(false);
      }),
    [],
  );

  const fail = (err: unknown) => {
    setLoading(false);
    setFailed(err instanceof Error ? err.message : String(err));
  };
  const run = (pending: Promise<unknown>) => {
    setFailed(undefined);
    pending.catch(fail);
  };
  const navigate = (pending: Promise<unknown>) => {
    setLoading(true);
    run(pending);
  };
  /** One at a time, so a click's press and release reach the page in order. */
  const send = (input: BrowserInput) => {
    queue.current = queue.current.then(() => api.browserInput(input)).catch(fail);
  };

  const live = Boolean(state?.running && frame);
  useEffect(() => {
    const el = keys.current;
    if (!live || !el) return;
    // React's wheel listener is passive; without this the panel scrolls along with the page.
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, [live]);

  // Keep the remote page the same size as this panel so the screencast fills it.
  useEffect(() => {
    const el = screenEl.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const publish = (width: number, height: number) => {
      const w = Math.round(width);
      const h = Math.round(height);
      const key = `${w}x${h}`;
      if (key === last || w < 200 || h < 200) return;
      last = key;
      void api.browserViewport({ width: w, height: h }).catch(() => {});
    };
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      clearTimeout(timer);
      timer = setTimeout(() => publish(box.width, box.height), 100);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, []);

  const tab = state?.tabs.find((t) => t.id === state.active);
  const dialog = state?.dialog;
  const shown = address ?? tab?.url ?? "";
  const secure = /^https:\/\//i.test(shown);

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = image.current?.getBoundingClientRect();
    if (!rect || !frame) return undefined;
    const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    if (outside && held.current === undefined) return undefined;
    const x = Math.min(Math.max(e.clientX, rect.left), rect.right);
    const y = Math.min(Math.max(e.clientY, rect.top), rect.bottom);
    return toPage(x, y, rect, frame);
  };
  const flushMove = () => {
    const m = moving.current;
    moving.current = undefined;
    if (m) send(m);
  };
  const press = (e: ReactMouseEvent, event: "down" | "up") => {
    const button = mouseButton(e.button);
    if (!button || (event === "up" && held.current === undefined)) return;
    const p = point(e);
    if (!p) return;
    if (event === "down") held.current ??= e.button;
    else if (held.current === e.button) held.current = undefined;
    flushMove();
    send({ type: "mouse", event, ...p, button, clickCount: Math.max(e.detail, 1), modifiers: modifiers(e) });
  };
  /** Sends the latest position once per throttle window, so the pointer ends where the mouse stopped. */
  const move = (e: ReactMouseEvent) => {
    const p = point(e);
    if (!p) return;
    const scheduled = moving.current !== undefined;
    moving.current = { type: "mouse", event: "move", ...p, button: e.buttons & 1 ? "left" : "none", clickCount: 0, modifiers: modifiers(e) };
    if (!scheduled) setTimeout(flushMove, THROTTLE_MS);
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
      {state && state.tabs.length > 0 ? (
        <div className="browser-tabs" role="tablist" aria-label="标签">
          {state.tabs.map((t) => (
            <div key={t.id} className={`browser-tab${t.id === state.active ? " on" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={t.id === state.active}
                title={t.url}
                onClick={() => run(api.browserTab({ id: t.id }))}
              >
                {t.title || t.url || "新标签"}
              </button>
              <button
                type="button"
                className="browser-tab-close"
                aria-label={`关闭 ${t.title || t.url || "标签"}`}
                title="关闭标签"
                onClick={(e) => {
                  e.stopPropagation();
                  run(api.browserTab({ id: t.id, close: true }));
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="preview-head browser-head">
        <div className="browser-nav">
          <IconBtn label="后退" disabled={!state?.running || loading} onClick={() => navigate(api.browserNav({ action: "back" }))}>
            <BackIcon />
          </IconBtn>
          <IconBtn label="前进" disabled={!state?.running || loading} onClick={() => navigate(api.browserNav({ action: "forward" }))}>
            <ForwardIcon />
          </IconBtn>
          <IconBtn label="刷新" disabled={!state?.running || loading} onClick={() => navigate(api.browserNav({ action: "reload" }))}>
            <ReloadIcon />
          </IconBtn>
        </div>
        <form
          className="browser-address"
          onSubmit={(e) => {
            e.preventDefault();
            const url = addressURL(shown);
            if (!url) return;
            setAddress(undefined);
            navigate(api.browserOpen({ url }));
          }}
        >
          {shown ? (
            <span className={`browser-lock${secure ? " on" : ""}`} aria-hidden>
              {secure ? (
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
                  <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="5.5" />
                  <path d="M8 2.5v11M2.5 8h11" strokeLinecap="round" />
                </svg>
              )}
            </span>
          ) : null}
          <input
            value={shown}
            placeholder="输入网址"
            spellCheck={false}
            aria-label="地址"
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => setAddress(undefined)}
          />
        </form>
        <div className="browser-actions">
          <IconBtn
            label="在系统浏览器打开"
            disabled={!tab || !/^https?:/.test(tab.url)}
            onClick={() => tab && window.open(tab.url, "_blank", "noreferrer")}
          >
            <ExternalIcon />
          </IconBtn>
          <IconBtn
            label="关闭浏览器"
            disabled={!state?.running}
            onClick={() => (state?.agent ? setClosing(true) : run(api.browserClose()))}
          >
            <PowerIcon />
          </IconBtn>
          <IconBtn label="收起" onClick={props.onClose}>
            <CloseIcon />
          </IconBtn>
        </div>
      </div>
      {props.agentBusy ? <div className="browser-agent">代理正在使用浏览器</div> : null}
      {failed || state?.error ? <div className="preview-note browser-error">{failed ?? state?.error}</div> : null}
      {closing ? (
        <div className="browser-dialog">
          <span>代理正在使用这个浏览器。仍然关闭？</span>
          <button
            type="button"
            onClick={() => {
              setClosing(false);
              run(api.browserClose());
            }}
          >
            关闭
          </button>
          <button type="button" onClick={() => setClosing(false)}>
            取消
          </button>
        </div>
      ) : null}
      {dialog ? (
        <form
          key={`${dialog.type}:${dialog.message}`}
          className="browser-dialog"
          onSubmit={(e) => {
            e.preventDefault();
            const text = new FormData(e.currentTarget).get("text");
            run(api.browserDialog({ accept: true, ...(typeof text === "string" ? { text } : {}) }));
          }}
        >
          <span>{dialog.message || (dialog.type === "beforeunload" ? "离开这个页面？" : "页面在询问")}</span>
          {dialog.type === "prompt" ? <input name="text" aria-label="回答" autoFocus /> : null}
          <button type="submit">确定</button>
          {dialog.type === "alert" ? null : (
            <button type="button" onClick={() => run(api.browserDialog({ accept: false }))}>
              取消
            </button>
          )}
        </form>
      ) : null}
      <div ref={screenEl} className="browser-screen">
        {live && frame ? (
          <div className="browser-frame">
            <img ref={image} src={frame.src} alt={tab?.title || "页面"} draggable={false} />
            <textarea
              ref={keys}
              className="browser-keys"
              aria-label="在页面里输入"
              spellCheck={false}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
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
            {loading || (state?.running && !frame) ? (
              <>
                <span className="spinner" /> 加载中…
              </>
            ) : state && !state.running ? (
              "在上面输入网址打开页面"
            ) : (
              <span className="spinner" />
            )}
          </div>
        )}
      </div>
    </>
  );
}
