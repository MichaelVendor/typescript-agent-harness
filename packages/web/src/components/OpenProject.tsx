import type { RecentFolder } from "@typescript-agent-harness/cli";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { FolderPicker } from "./FolderPicker";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Recent projects first; "Choose folder…" opens the system dialog (the in-page browser when there is none). */
export function OpenProject(props: { busy: boolean; onOpen(path: string): Promise<void>; onClose(): void }) {
  const [recent, setRecent] = useState<RecentFolder[]>();
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const { onClose } = props;

  const open = async (path: string) => {
    setPending(true);
    try {
      await props.onOpen(path);
    } catch (err) {
      setPending(false);
      setError(text(err));
    }
  };

  /** `closeOnCancel`: the dialog was opened for the user (no recent projects), so cancelling ends it. */
  const choose = async (closeOnCancel: boolean) => {
    setPending(true);
    setError(undefined);
    try {
      const picked = await api.choose();
      if (picked) return void (await open(picked));
      if (closeOnCancel) return onClose();
      setPending(false);
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.status === 501) setBrowsing(true);
      else setError(text(err));
    }
  };

  useEffect(() => {
    api.recent().then(
      (rows) => {
        setRecent(rows);
        if (rows.length === 0) void choose(true);
      },
      () => setRecent([]),
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (browsing) return <FolderPicker busy={props.busy} onOpen={props.onOpen} onClose={onClose} />;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Open project">
        <div className="modal-title">{recent?.length ? "Recent projects" : "Open project"}</div>
        {recent?.length ? (
          <ul className="dirs recent">
            {recent.map((r) => (
              <li key={r.path}>
                <button type="button" title={r.path} disabled={props.busy || pending} onClick={() => void open(r.path)}>
                  {r.name}
                  <span className="dir-path">{r.path}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="sidebar-note">Choose a folder in the system dialog…</div>
        )}
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="card-actions">
          <button type="button" className="primary" disabled={props.busy || pending} onClick={() => void choose(false)}>
            Choose folder…
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
