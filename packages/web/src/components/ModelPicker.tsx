import type { SettingsView } from "@typescript-agent-harness/cli";
import { useEffect, useRef, useState } from "react";
import { groupModels, modelLabel } from "../model-view";
import { ChevronIcon, GearIcon } from "./Sidebar";

/** The composer's model button: switches the model every session uses (Settings → Models → Use). */
export function ModelPicker(props: {
  view: SettingsView | undefined;
  busy: boolean;
  /** `null` = the model from `.env`. */
  onPick(id: string | null): void;
  onManage(): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { view } = props;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (props.busy) setOpen(false);
  }, [props.busy]);

  if (!view) return null;
  const pick = (id: string | null) => {
    setOpen(false);
    if (id !== view.activeModel) props.onPick(id);
  };

  return (
    <div className="model-picker" ref={ref}>
      <button
        type="button"
        className={open ? "model-btn on" : "model-btn"}
        disabled={props.busy}
        title={props.busy ? "Wait for the reply to finish to switch models" : "Switch model"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {modelLabel(view)}
        <span className="model-chev">
          <ChevronIcon open={false} />
        </span>
      </button>
      {open ? (
        <ul className="context-menu model-menu" role="menu">
          {groupModels(view.models).map((g) => (
            <li key={g.name} role="none">
              <div className="menu-label">{g.name}</div>
              <ul role="none">
                {g.models.map((m) => (
                  <li key={m.id} role="none">
                    <button type="button" role="menuitemradio" aria-checked={m.id === view.activeModel} onClick={() => pick(m.id)}>
                      {m.model}
                      {m.vision ? <span className="model-key">images</span> : null}
                      <span className="model-check">{m.id === view.activeModel ? "✓" : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {view.env ? (
            <li role="none">
              <div className="menu-label">From .env</div>
              <button type="button" role="menuitemradio" aria-checked={view.activeModel === null} onClick={() => pick(null)}>
                {view.env.model}
                <span className="model-key">{view.env.key}</span>
                <span className="model-check">{view.activeModel === null ? "✓" : ""}</span>
              </button>
            </li>
          ) : null}
          <li role="separator" className="menu-sep" />
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                props.onManage();
              }}
            >
              <span className="model-gear">
                <GearIcon />
              </span>
              {view.models.length ? "Manage models…" : "Add a model…"}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
