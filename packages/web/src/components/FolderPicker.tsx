import type { DirListing } from "@typescript-agent-harness/cli";
import { useEffect, useState } from "react";
import { api } from "../api";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));
const join = (dir: string, name: string) => `${dir.replace(/[\\/]$/, "")}/${name}`;

/** Browse sub-folders from home, optionally create one, then open it as a workspace. */
export function FolderPicker(props: { busy: boolean; onOpen(path: string): Promise<void>; onClose(): void }) {
  const [listing, setListing] = useState<DirListing>();
  const [error, setError] = useState<string>();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [opening, setOpening] = useState(false);
  const { onClose } = props;

  const go = (path?: string) =>
    api.fs(path).then(
      (next) => {
        setListing(next);
        setError(undefined);
      },
      (err: unknown) => setError(text(err)),
    );

  useEffect(() => {
    void go();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Add folder">
        <div className="crumbs">
          {listing?.crumbs.map((c, i) => (
            <button key={c.path} type="button" onClick={() => void go(c.path)}>
              {i === 0 ? c.name : `${c.name}/`}
            </button>
          ))}
        </div>
        <ul className="dirs">
          {listing?.parent ? (
            <li>
              <button type="button" onClick={() => void go(listing.parent ?? undefined)}>..</button>
            </li>
          ) : null}
          {listing?.dirs.map((d) => (
            <li key={d}>
              <button type="button" onClick={() => void go(join(listing.path, d))}>{d}</button>
            </li>
          ))}
        </ul>
        {naming && listing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              api.mkdir({ path: listing.path, name: name.trim() }).then(
                (made) => {
                  setNaming(false);
                  setName("");
                  return go(made.path);
                },
                (err: unknown) => setError(text(err)),
              );
            }}
          >
            <input
              autoFocus
              className="session-rename"
              value={name}
              placeholder="New folder name"
              aria-label="New folder name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setNaming(false);
                }
              }}
            />
          </form>
        ) : null}
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="card-actions">
          <button type="button" disabled={!listing} onClick={() => setNaming(true)}>
            New folder
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!listing || props.busy || opening}
            onClick={() => {
              if (!listing) return;
              setOpening(true);
              props.onOpen(listing.path).catch((err: unknown) => {
                setOpening(false);
                setError(text(err));
              });
            }}
          >
            Open this folder
          </button>
        </div>
      </div>
    </div>
  );
}
