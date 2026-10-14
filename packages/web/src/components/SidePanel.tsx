import { useRef, useState, type PointerEvent, type ReactNode } from "react";

const WIDTH = "tah.previewWidth";

/** The right-hand panel: resizable (width remembered), with a File / Browser switch when both are open. */
export function SidePanel(props: {
  view: "file" | "browser";
  both: boolean;
  onView(view: "file" | "browser"): void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() =>
    Math.max(Math.min(Number(localStorage.getItem(WIDTH)) || 480, window.innerWidth - 360), 280),
  );
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = Math.max(Math.min(drag.current.width + drag.current.x - e.clientX, window.innerWidth - 360), 280);
    setWidth(next);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = undefined;
    localStorage.setItem(WIDTH, String(width));
  };

  return (
    <aside className="side-panel" style={{ width }}>
      <div className="preview-resize" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} />
      {props.both ? (
        <div className="side-switch" role="tablist">
          {(["file", "browser"] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={props.view === view}
              className={props.view === view ? "active" : ""}
              onClick={() => props.onView(view)}
            >
              {view === "file" ? "File" : "Browser"}
            </button>
          ))}
        </div>
      ) : null}
      {props.children}
    </aside>
  );
}
