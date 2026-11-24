import type { TeamMember } from "@typescript-agent-harness/cli";
import { useEffect, useState } from "react";
import { api } from "../api";
import { TrashIcon } from "./icons";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

function emptyMember(): TeamMember {
  return { id: "", displayName: "", persona: "" };
}

/** Edit `tah.team.json` roster (must keep one member with id `tl`). */
export function TeamSettings(props: { busy: boolean }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [pending, setPending] = useState(false);
  const locked = props.busy || pending;

  useEffect(() => {
    void api.teamGet().then((view) => setMembers(view.members), (err: unknown) => setError(text(err)));
  }, []);

  const save = async () => {
    setPending(true);
    setError(undefined);
    setNote(undefined);
    try {
      const view = await api.teamSave({ members });
      setMembers(view.members);
      setNote("Saved to tah.team.json in this folder. New goals pick up the roster.");
    } catch (err) {
      setError(text(err));
    } finally {
      setPending(false);
    }
  };

  const update = (index: number, patch: Partial<TeamMember>) => {
    setMembers((rows) => rows.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const remove = (index: number) => {
    const id = members[index]?.id;
    if (id === "tl") return;
    setMembers((rows) => rows.filter((_, i) => i !== index));
  };

  const add = () => setMembers((rows) => [...rows, emptyMember()]);

  const hasTl = members.some((m) => m.id.trim() === "tl");

  return (
    <>
      <p className="settings-desc">
        Named agents for <code>tah serve --room</code>. Roster is stored as <code>tah.team.json</code> in the open
        folder. A member with id <code>tl</code> is required.
      </p>
      <ul className="model-cards team-cards">
        {members.map((m, i) => (
          <li key={`${i}:${m.id}`} className="model-card team-card">
            <div className="team-fields">
              <label>
                <span>id</span>
                <input
                  value={m.id}
                  disabled={locked || m.id === "tl"}
                  placeholder="researcher"
                  onChange={(e) => update(i, { id: e.target.value })}
                />
              </label>
              <label>
                <span>displayName</span>
                <input value={m.displayName} disabled={locked} onChange={(e) => update(i, { displayName: e.target.value })} />
              </label>
              <label className="team-persona">
                <span>persona</span>
                <textarea
                  rows={2}
                  value={m.persona}
                  disabled={locked}
                  onChange={(e) => update(i, { persona: e.target.value })}
                />
              </label>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${m.id || "member"}`}
              title={m.id === "tl" ? "Keep TL" : "Remove"}
              disabled={locked || m.id === "tl"}
              onClick={() => remove(i)}
            >
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
      <div className="card-actions">
        <button type="button" disabled={locked} onClick={add}>
          + Add member
        </button>
        <span className="spacer" />
        <button type="button" className="primary" disabled={locked || !hasTl} onClick={() => void save()}>
          Save team
        </button>
      </div>
      {error ? <div className="modal-error">{error}</div> : null}
      {note ? <div className="settings-note">{note}</div> : null}
      {props.busy ? <div className="settings-note">Wait for the current reply to finish before saving.</div> : null}
    </>
  );
}