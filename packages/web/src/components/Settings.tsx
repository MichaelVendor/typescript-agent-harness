import type { SettingsView } from "@typescript-agent-harness/cli";
import { useEffect, useState } from "react";
import { api } from "../api";
import { TrashIcon } from "./icons";
import { SkillsSettings } from "./SkillsSettings";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

const guessURL = (model: string) =>
  model.trim().toLowerCase().startsWith("deepseek") ? "https://api.deepseek.com/v1" : "https://api.openai.com/v1";

function provider(baseURL: string): string {
  try {
    const host = new URL(baseURL).host;
    if (host === "api.deepseek.com") return "DeepSeek";
    if (host === "api.openai.com") return "OpenAI";
    return host;
  } catch {
    return baseURL;
  }
}

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
);

const SECTIONS = { models: "Models", web: "Web search", skills: "Skills" } as const;
type Section = keyof typeof SECTIONS;

/** Cursor-style settings: section nav on the left, the chosen page on the right. */
export function Settings(props: {
  busy: boolean;
  view: SettingsView;
  onChange(view: SettingsView): void;
  onClose(): void;
}) {
  const [section, setSection] = useState<Section>("models");
  const { onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-label="Settings">
        <nav className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {(Object.keys(SECTIONS) as Section[]).map((key) => (
            <button key={key} type="button" className={key === section ? "active" : undefined} onClick={() => setSection(key)}>
              {SECTIONS[key]}
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <header className="settings-head">
            <h2>{SECTIONS[section]}</h2>
            <button type="button" className="icon-btn" aria-label="Close settings" title="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </header>
          {section === "models" ? (
            <ModelsSettings busy={props.busy} view={props.view} onChange={props.onChange} />
          ) : section === "web" ? (
            <WebSettings busy={props.busy} view={props.view} onChange={props.onChange} />
          ) : (
            <SkillsSettings busy={props.busy} />
          )}
        </section>
      </div>
    </div>
  );
}

/** The Tavily key behind web_search; web_fetch needs no key. */
function WebSettings(props: { busy: boolean; view: SettingsView; onChange(view: SettingsView): void }) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const { search } = props.view;
  const locked = props.busy || pending;

  const save = async (key: string | null) => {
    setPending(true);
    setError(undefined);
    try {
      props.onChange(await api.searchKey({ apiKey: key }));
      setApiKey("");
    } catch (err) {
      setError(text(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <p className="settings-desc">
        The agent reads web pages with web_fetch out of the box. To let it search the web too, add a{" "}
        <a href="https://app.tavily.com" target="_blank" rel="noreferrer">
          Tavily
        </a>{" "}
        API key (free tier available). It applies to every folder.
      </p>

      {search ? (
        <ul className="model-cards">
          <li className="model-card in-use">
            <div className="model-main">
              <div className="model-name">Tavily</div>
              <div className="model-meta">
                {search.keyHint} · {search.source === "env" ? "from TAVILY_API_KEY in .env" : "saved in settings"}
              </div>
            </div>
            <span className="badge">On</span>
            {search.source === "settings" ? (
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove Tavily key"
                title="Remove"
                disabled={locked}
                onClick={() => void save(null)}
              >
                <TrashIcon />
              </button>
            ) : null}
          </li>
        </ul>
      ) : (
        <div className="settings-empty">Web search is off — no key yet.</div>
      )}

      <form
        className="model-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(apiKey);
        }}
      >
        <label>
          <span>{search ? "Replace API key" : "Tavily API key"}</span>
          <input type="password" autoComplete="off" value={apiKey} placeholder="tvly-…" onChange={(e) => setApiKey(e.target.value)} />
          <small>Stored only on this computer, in ~/.tah/settings.json.</small>
        </label>
        <div className="card-actions">
          <span className="spacer" />
          <button type="submit" className="primary" disabled={locked || !apiKey.trim()}>
            Save key
          </button>
        </div>
      </form>

      {error ? <div className="modal-error">{error}</div> : null}
      {props.busy ? <div className="settings-note">Wait for the current reply to finish to change the key.</div> : null}
    </>
  );
}

/** Saved LLM models; keys are write-only here. */
function ModelsSettings(props: { busy: boolean; view: SettingsView; onChange(view: SettingsView): void }) {
  const [adding, setAdding] = useState(props.view.models.length === 0);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [vision, setVision] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const { view } = props;
  const locked = props.busy || pending;
  const active = view.models.find((m) => m.id === view.activeModel);

  const save = async (change: Promise<SettingsView>) => {
    setPending(true);
    setError(undefined);
    try {
      props.onChange(await change);
      return true;
    } catch (err) {
      setError(text(err));
      return false;
    } finally {
      setPending(false);
    }
  };

  const closeForm = () => {
    setAdding(false);
    setModel("");
    setApiKey("");
    setBaseURL("");
    setVision(false);
    setError(undefined);
  };

  const add = async () => {
    const input = { model, apiKey, vision, ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}) };
    if (await save(api.addModel(input))) closeForm();
  };

  return (
    <>
      <p className="settings-desc">
        Add an API key for DeepSeek, OpenAI, or any OpenAI-compatible service. The model in use applies to every
        folder; switching takes effect on the next message.
      </p>

      {view.models.length ? (
        <ul className="model-cards">
          {view.models.map((m) => {
            const inUse = m.id === view.activeModel;
            return (
              <li key={m.id} className={inUse ? "model-card in-use" : "model-card"}>
                <div className="model-main">
                  <div className="model-name">{m.model}</div>
                  <div className="model-meta" title={m.baseURL}>
                    {provider(m.baseURL)} · {m.keyHint}
                  </div>
                </div>
                <label className="model-vision" title="Send image attachments to this model">
                  <input
                    type="checkbox"
                    checked={m.vision}
                    disabled={locked}
                    onChange={(e) => void save(api.modelVision({ id: m.id, vision: e.target.checked }))}
                  />
                  Images
                </label>
                {inUse ? (
                  <span className="badge">In use</span>
                ) : (
                  <button type="button" disabled={locked} onClick={() => void save(api.activeModel({ id: m.id }))}>
                    Use
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${m.model}`}
                  title="Remove"
                  disabled={locked}
                  onClick={() => void save(api.removeModel({ id: m.id }))}
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>
      ) : adding ? null : (
        <div className="settings-empty">No models yet.</div>
      )}

      {adding ? (
        <form
          className="model-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label>
            <span>Model name</span>
            <input autoFocus value={model} placeholder="deepseek-chat" onChange={(e) => setModel(e.target.value)} />
          </label>
          <label>
            <span>API Key</span>
            <input type="password" autoComplete="off" value={apiKey} placeholder="sk-…" onChange={(e) => setApiKey(e.target.value)} />
            <small>Stored only on this computer, in ~/.tah/settings.json.</small>
          </label>
          <label>
            <span>
              Base URL <em>optional</em>
            </span>
            <input value={baseURL} placeholder={guessURL(model)} onChange={(e) => setBaseURL(e.target.value)} />
            <small>Leave empty to use {guessURL(model)}</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
            <span>Can read images</span>
          </label>
          <small className="check-note">
            Sends image attachments to the model. Leave off for text-only models such as deepseek-chat.
          </small>
          <div className="card-actions">
            <span className="spacer" />
            {view.models.length ? (
              <button type="button" onClick={closeForm}>
                Cancel
              </button>
            ) : null}
            <button type="submit" className="primary" disabled={locked || !model.trim() || !apiKey.trim()}>
              Add model
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="add-model" disabled={locked} onClick={() => setAdding(true)}>
          + Add model
        </button>
      )}

      {error ? <div className="modal-error">{error}</div> : null}
      {props.busy ? <div className="settings-note">Wait for the current reply to finish to change models.</div> : null}

      <div className="settings-note">
        {active ? (
          <>
            Using <strong>{active.model}</strong>.{" "}
            <button type="button" className="link" disabled={locked} onClick={() => void save(api.activeModel({ id: null }))}>
              Use .env instead
            </button>
          </>
        ) : (
          <>No model in use — keys come from DEEPSEEK_API_KEY / OPENAI_API_KEY in .env.</>
        )}
      </div>
    </>
  );
}
