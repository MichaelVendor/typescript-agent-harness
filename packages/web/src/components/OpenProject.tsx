import type { RecentFolder } from "@typescript-agent-harness/cli";
import { useEffect, useState } from "react";
import { api } from "../api";
import { FolderPicker } from "./FolderPicker";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Recent projects first; "Browse…" (or no recent ones) falls back to the folder picker. */
export function OpenProject(props: { busy: boolean; onOpen(path: string): Promise<void>; onClose(): void }) {
  const [recent, setRecent] = useState<RecentFolder[]>();
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const { onClose } = props;

  useEffect(() => {
    api.recent().then(setRecent, () => setRecent([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (browsing || recent?.length === 0) return <FolderPicker busy={props.busy} onOpen={props.onOpen} onClose={onClose} />;

  const open = (path: string) => {
    setOpening(true);
    props.onOpen(path).catch((err: unknown) => {
      setOpening(false);
      setError(text(err));
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Open project">
        <div className="modal-title">Recent projects</div>
        <ul className="dirs recent">
          {recent?.map((r) => (
            <li key={r.path}>
              <button type="button" title={r.path} disabled={props.busy || opening} onClick={() => open(r.path)}>
                {r.name}
                <span className="dir-path">{r.path}</span>
              </button>
            </li>
          ))}
        </ul>
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="card-actions">
          <button type="button" onClick={() => setBrowsing(true)}>
            Browse…
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
