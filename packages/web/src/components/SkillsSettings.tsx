import type { SkillsImport, SkillsView } from "@typescript-agent-harness/cli";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { FolderPicker } from "./FolderPicker";
import { TrashIcon } from "./icons";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

function outcome(r: SkillsImport): string {
  const parts = [r.imported.length ? `Imported ${r.imported.join(", ")}.` : "Nothing new imported."];
  if (r.skipped.length) parts.push(`Skipped ${r.skipped.join("; ")}.`);
  return parts.join(" ");
}

type Skill = SkillsView["skills"][number];

/** Skills the open folder loads; import copies skill folders into ~/.tah/skills. */
export function SkillsSettings(props: { busy: boolean }) {
  const [view, setView] = useState<SkillsView>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const [pending, setPending] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const locked = props.busy || pending;

  useEffect(() => {
    api.skills().then(setView, (err: unknown) => setError(text(err)));
  }, []);

  const importFrom = async (path: string) => {
    setPending(true);
    try {
      const r = await api.importSkills({ path });
      setView(r);
      setResult(outcome(r));
    } catch (err) {
      setError(text(err));
    } finally {
      setPending(false);
    }
  };

  const choose = async () => {
    setError(undefined);
    setResult(undefined);
    setPending(true);
    let picked: string | null;
    try {
      picked = await api.choose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) setBrowsing(true);
      else setError(text(err));
      return;
    } finally {
      setPending(false);
    }
    if (picked) await importFrom(picked);
  };

  const remove = async (name: string) => {
    setError(undefined);
    setResult(undefined);
    setPending(true);
    try {
      setView(await api.removeSkill({ name }));
    } catch (err) {
      setError(text(err));
    } finally {
      setPending(false);
    }
  };

  const card = (s: Skill) => (
    <li key={`${s.source}:${s.name}`} className="model-card">
      <div className="model-main">
        <div className="model-name">{s.name}</div>
        <div className="skill-desc" title={`${s.description}\n${s.path}`}>
          {s.description}
        </div>
      </div>
      {s.source === "home" ? (
        <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} title="Remove" disabled={locked} onClick={() => void remove(s.name)}>
          <TrashIcon />
        </button>
      ) : null}
    </li>
  );

  const home = view?.skills.filter((s) => s.source === "home") ?? [];
  const folder = view?.skills.filter((s) => s.source === "folder") ?? [];

  return (
    <>
      <p className="settings-desc">
        Skills are instructions the agent loads when a task matches. Import a folder with a SKILL.md, or a folder of them such as
        ~/.cursor/skills or ~/.claude/skills. Imported skills are copied to ~/.tah/skills and work in every folder.
      </p>
      <button type="button" className="add-model" disabled={locked} onClick={() => void choose()}>
        Import skill folder…
      </button>
      {result ? <div className="settings-note">{result}</div> : null}
      {error ? <div className="modal-error">{error}</div> : null}
      {props.busy ? <div className="settings-note">Wait for the current reply to finish to change skills.</div> : null}

      {view ? (
        <>
          <div className="settings-subhead">All folders · ~/.tah/skills</div>
          {home.length ? <ul className="model-cards">{home.map(card)}</ul> : <div className="settings-empty">None imported yet.</div>}
          <div className="settings-subhead">This folder · skills/, .agents/skills/, .cursor/skills/</div>
          {folder.length ? <ul className="model-cards">{folder.map(card)}</ul> : <div className="settings-empty">None.</div>}
        </>
      ) : null}

      {browsing ? (
        <FolderPicker
          busy={props.busy}
          confirmLabel="Import"
          onOpen={async (path) => {
            setBrowsing(false);
            await importFrom(path);
          }}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
    </>
  );
}
