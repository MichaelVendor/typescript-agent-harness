import type { AttachmentMeta } from "@typescript-agent-harness/cli";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { imageChip, imageIndex, insertImageChip, removeImageChip } from "../image-chip";

type Draft = AttachmentMeta & { status: "uploading" | "ready" | "error"; error?: string; preview?: string };

type Mention = { start: number; query: string; files: string[]; index: number };

export type SlashCommand = {
  name: string;
  description: string;
  /** Built-in action; omit for a user-invocable skill (`/name` is sent as a message). */
  run?: "compact" | "reset" | "fork";
};

const SLASH: SlashCommand[] = [
  { name: "/compact", description: "压缩上下文", run: "compact" },
  { name: "/fork", description: "分叉当前会话", run: "fork" },
  { name: "/reset", description: "新会话", run: "reset" },
];

export function Composer(props: {
  cwd?: string;
  /** Permission chip. `onCycle` switches 手动 / 接受编辑 / 计划. */
  mode?: { label: string; title?: string; onCycle?: () => void };
  /** Gray text in an empty composer. Tab or → accepts it; typing dismisses it; Enter does not send it. */
  suggestion?: string;
  busy: boolean;
  disabled: boolean;
  onSend(text: string, attachmentIds: string[]): void;
  onStop(): void;
  onCommand?(run: NonNullable<SlashCommand["run"]>): void;
  /** Shown left of the send button (the model picker). */
  children?: ReactNode;
  /** Short chips above the box. Clicking one sends `send`. */
  suggestions?: { label: string; send: string; detail?: string }[];
}) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mention, setMention] = useState<Mention | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashExtras, setSlashExtras] = useState<SlashCommand[]>([]);
  /** After picking from the menu, hide it until the user edits — next Enter sends/runs. */
  const [slashLocked, setSlashLocked] = useState(false);
  const [hideSuggestion, setHideSuggestion] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ghost = !text && props.suggestion && !hideSuggestion ? props.suggestion : undefined;
  const slashQuery = text.trim();
  const slashOpen = !props.busy && !slashLocked && /^\/\S*$/.test(slashQuery);
  const slashMatches = slashOpen
    ? [
        ...(props.onCommand ? SLASH : []),
        ...slashExtras.filter((c) => !SLASH.some((b) => b.name === c.name)),
      ].filter((c) => c.name.startsWith(slashQuery))
    : [];
  useEffect(() => setSlashIndex(0), [text]);

  useEffect(() => {
    if (!slashOpen) return;
    let cancelled = false;
    void api.skills().then(
      (view) => {
        if (cancelled) return;
        const taken = new Set(SLASH.map((c) => c.name));
        const extras: SlashCommand[] = [];
        for (const s of view.skills) {
          if (!s.userInvocable) continue;
          const name = `/${s.name}`;
          if (taken.has(name)) continue;
          taken.add(name);
          extras.push({ name, description: s.description });
        }
        for (const p of view.prompts ?? []) {
          const name = `/${p.name}`;
          if (taken.has(name)) continue;
          taken.add(name);
          extras.push({ name, description: p.description });
        }
        setSlashExtras(extras);
      },
      () => {
        if (!cancelled) setSlashExtras([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [slashOpen, props.cwd]);

  useEffect(() => {
    setHideSuggestion(false);
  }, [props.suggestion]);

  useEffect(() => {
    const caret = ref.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (!match) {
      setMention(null);
      return;
    }
    const query = match[1] ?? "";
    const start = match.index + match[0].length - query.length - 1;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.names(query).then(
        (res) => {
          if (!cancelled) setMention({ start, query, files: res.files, index: 0 });
        },
        () => {
          if (!cancelled) setMention(null);
        },
      );
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text]);

  const insertMention = (file: string) => {
    if (!mention) return;
    const caret = ref.current?.selectionStart ?? text.length;
    setText(`${text.slice(0, mention.start)}${file} ${text.slice(caret)}`);
    setMention(null);
    setHideSuggestion(true);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight - el.clientHeight <= 1) return;
    const style = getComputedStyle(el);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    el.style.height = `${Math.min(el.scrollHeight + border, 240)}px`;
  }, [text]);

  // Uploads live in the folder that was active; they can't be sent from another one.
  useEffect(() => {
    setDrafts((d) => {
      for (const x of d) if (x.preview) URL.revokeObjectURL(x.preview);
      return [];
    });
  }, [props.cwd]);

  const uploading = drafts.some((d) => d.status === "uploading");
  const readyIds = drafts.filter((d) => d.status === "ready").map((d) => d.id);
  const canSend = !props.disabled && !uploading && (Boolean(text.trim()) || readyIds.length > 0);

  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of [...files]) {
      const localId = `local_${Math.random().toString(36).slice(2)}`;
      const isImage = file.type.startsWith("image/");
      const preview = isImage ? URL.createObjectURL(file) : undefined;
      setDrafts((d) => {
        const next: Draft[] = [
          ...d,
          {
            id: localId,
            kind: isImage ? "image" : "file",
            name: file.name,
            mime: file.type || "application/octet-stream",
            bytes: file.size,
            sha256: "",
            status: "uploading",
            ...(preview ? { preview } : {}),
          },
        ];
        if (isImage) {
          const n = imageIndex(next, localId)!;
          setText((t) => {
            const caret = ref.current?.selectionStart ?? t.length;
            const placed = insertImageChip(t, caret, n);
            setHideSuggestion(true);
            requestAnimationFrame(() => {
              const el = ref.current;
              if (!el) return;
              el.focus();
              el.setSelectionRange(placed.caret, placed.caret);
            });
            return placed.text;
          });
        }
        return next;
      });
      try {
        const meta = await api.upload(file);
        setDrafts((d) =>
          d.map((item) => (item.id === localId ? { ...meta, status: "ready" as const, preview: item.preview } : item)),
        );
      } catch (err) {
        setDrafts((d) =>
          d.map((item) =>
            item.id === localId
              ? {
                  ...item,
                  status: "error",
                  error: err instanceof Error ? err.message : String(err),
                }
              : item,
          ),
        );
      }
    }
  };

  /** Insert the pick into the composer; do not run/send (Claude-style). */
  const pickSlash = (cmd: SlashCommand) => {
    setText(cmd.name);
    setHideSuggestion(true);
    setSlashLocked(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const n = cmd.name.length;
      el.setSelectionRange(n, n);
    });
  };

  const send = () => {
    const line = text.trim();
    const builtin = SLASH.find((c) => c.name === line && c.run);
    if (builtin?.run) {
      setText("");
      setHideSuggestion(true);
      setSlashLocked(false);
      props.onCommand?.(builtin.run);
      return;
    }
    if (!canSend) return;
    props.onSend(text, readyIds);
    setText("");
    setSlashLocked(false);
    for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview);
    setDrafts([]);
  };

  const remove = (id: string) => {
    setDrafts((d) => {
      const hit = d.find((x) => x.id === id);
      const n = hit ? imageIndex(d, id) : undefined;
      if (hit?.preview) URL.revokeObjectURL(hit.preview);
      if (n !== undefined) setText((t) => removeImageChip(t, n));
      return d.filter((x) => x.id !== id);
    });
  };

  return (
    <div
      className="composer-wrap"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (props.disabled) return;
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      {mention && mention.files.length > 0 ? (
        <ul className="context-menu mention-menu" role="listbox" aria-label="Files">
          {mention.files.map((file, i) => (
            <li key={file}>
              <button
                type="button"
                role="option"
                aria-selected={i === mention.index}
                className={i === mention.index ? "on" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(file);
                }}
              >
                {file}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {slashMatches.length > 0 ? (
        <ul className="context-menu mention-menu" role="listbox" aria-label="Commands">
          {slashMatches.map((cmd, i) => (
            <li key={cmd.name}>
              <button
                type="button"
                role="option"
                aria-selected={i === slashIndex}
                className={i === slashIndex ? "on" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSlash(cmd);
                }}
              >
                {cmd.name}
                <span className="menu-label"> {cmd.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {props.suggestions && props.suggestions.length > 0 ? (
        <div className="suggest" aria-label="可搜">
          {props.suggestions.every((item) => item.detail && item.detail === props.suggestions?.[0]?.detail) ? (
            <span className="suggest-note">{props.suggestions[0]?.detail}</span>
          ) : null}
          {props.suggestions.map((item, i) => (
            <button
              key={`${item.send}-${i}`}
              type="button"
              className="composer-chip suggest-chip"
              disabled={props.disabled}
              title={item.detail ? `${item.detail}：${item.label}` : item.label}
              onClick={() => props.onSend(item.send, [])}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="composer">
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {drafts.length ? (
          <div className="attach-rail" aria-label="Attachments">
            {drafts.map((d) => {
              const n = imageIndex(drafts, d.id);
              const label = n !== undefined ? imageChip(n) : d.name;
              return (
                <div
                  key={d.id}
                  className={`image-chip ${d.kind} ${d.status}`}
                  title={d.error ?? d.name}
                >
                  {d.preview ? <img src={d.preview} alt="" /> : null}
                  <span className="image-chip-label">
                    {d.status === "uploading" ? `${label}…` : d.status === "error" ? d.error ?? label : label}
                  </span>
                  <button type="button" className="image-chip-remove" onClick={() => remove(d.id)} aria-label={`Remove ${label}`}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="composer-field">
          {ghost ? <div className="composer-ghost">{ghost}</div> : null}
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={ghost ? "" : props.busy ? "这一轮结束后再发出" : "给一个任务，@ 提文件"}
            disabled={props.disabled}
            onChange={(e) => {
              setText(e.target.value);
              setSlashLocked(false);
              if (e.target.value) setHideSuggestion(true);
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length === 0 || props.disabled) return;
              e.preventDefault();
              void uploadFiles(files);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") {
                e.preventDefault();
                if (mention) {
                  setMention(null);
                  return;
                }
                if (slashMatches.length) {
                  setText("");
                  return;
                }
                if (text || drafts.length) {
                  setText("");
                  for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview);
                  setDrafts([]);
                  setHideSuggestion(true);
                  return;
                }
                if (props.busy) props.onStop();
                return;
              }
              if (e.key === "Backspace" && drafts.length && text === "") {
                e.preventDefault();
                remove(drafts[drafts.length - 1]!.id);
                return;
              }
              if (slashMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIndex((i) => (i + 1) % slashMatches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                  return;
                }
                if ((e.key === "Enter" || e.key === "Tab") && slashMatches[slashIndex]) {
                  const selected = slashMatches[slashIndex]!;
                  // Tab always inserts. Enter inserts unless the line already equals the pick (then send).
                  if (e.key === "Tab" || text.trim() !== selected.name) {
                    e.preventDefault();
                    pickSlash(selected);
                    return;
                  }
                }
              }
              if (mention && mention.files.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMention({ ...mention, index: (mention.index + 1) % mention.files.length });
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMention({ ...mention, index: (mention.index - 1 + mention.files.length) % mention.files.length });
                  return;
                }
                if ((e.key === "Enter" || e.key === "Tab") && mention.files[mention.index]) {
                  e.preventDefault();
                  insertMention(mention.files[mention.index]!);
                  return;
                }
              }
              if (ghost && (e.key === "Tab" || (e.key === "ArrowRight" && (ref.current?.selectionStart ?? 0) === 0))) {
                e.preventDefault();
                setText(ghost);
                setHideSuggestion(true);
                return;
              }
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              send();
            }}
          />
        </div>
        <div className="composer-bar">
          <button
            type="button"
            className="attach-btn"
            disabled={props.disabled}
            title="Attach files"
            onClick={() => fileRef.current?.click()}
          >
            +
          </button>
          {props.cwd ? <span className="composer-chip">{props.cwd.split(/[/\\]/).filter(Boolean).at(-1)}</span> : null}
          {props.mode ? (
            props.mode.onCycle ? (
              <button type="button" className="composer-chip" title={props.mode.title} onClick={props.mode.onCycle}>
                {props.mode.label}
              </button>
            ) : (
              <span className="composer-chip">{props.mode.label}</span>
            )
          ) : null}
          <span className="spacer" />
          {props.children}
          {props.busy ? (
            <button type="button" className="send-btn stop" onClick={props.onStop} title="Stop" aria-label="Stop">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button type="button" className="send-btn" onClick={send} disabled={!canSend} title="Send" aria-label="Send">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
