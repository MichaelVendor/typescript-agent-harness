import { useEffect, useState } from "react";
import { api } from "../api";
import { FolderPicker } from "./FolderPicker";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Name a new folder (on the Desktop unless the user picks another place), create it, then open it. */
export function NewFolder(props: { busy: boolean; desktop: string; onOpen(path: string): Promise<void>; onClose(): void }) {
  const [name, setName] = useState("");
  const [where, setWhere] = useState(props.desktop);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const { onClose } = props;

  useEffect(() => {
    if (choosing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, choosing]);

  if (choosing) {
    return (
      <FolderPicker
        busy={false}
        start={where}
        confirmLabel="Use this location"
        onOpen={async (path) => {
          setWhere(path);
          setChoosing(false);
        }}
        onClose={() => setChoosing(false)}
      />
    );
  }

  const canCreate = Boolean(name.trim()) && !props.busy && !creating;
  const create = () => {
    if (!canCreate) return;
    setCreating(true);
    api
      .mkdir({ path: where, name: name.trim() })
      .then((made) => props.onOpen(made.path))
      .catch((err: unknown) => {
        setCreating(false);
        setError(text(err));
      });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="New folder">
        <div className="modal-title">New folder</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input
            autoFocus
            className="session-rename"
            value={name}
            placeholder="Folder name"
            aria-label="Folder name"
            onChange={(e) => setName(e.target.value)}
          />
        </form>
        <div className="new-folder-where">
          <span>Location</span>
          <span className="where-path" title={where}>
            {where}
          </span>
          <button type="button" onClick={() => setChoosing(true)}>
            Change…
          </button>
        </div>
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="card-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canCreate} onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
