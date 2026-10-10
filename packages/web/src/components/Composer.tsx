import type { AttachmentMeta } from "@typescript-agent-harness/cli";
import { useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";

type Draft = AttachmentMeta & { status: "uploading" | "ready" | "error"; error?: string; preview?: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function Composer(props: {
  busy: boolean;
  disabled: boolean;
  onSend(text: string, attachmentIds: string[]): void;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight - el.clientHeight <= 1) return;
    const style = getComputedStyle(el);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    el.style.height = `${Math.min(el.scrollHeight + border, 240)}px`;
  }, [text]);

  const uploading = drafts.some((d) => d.status === "uploading");
  const readyIds = drafts.filter((d) => d.status === "ready").map((d) => d.id);
  const canSend = !props.busy && !props.disabled && !uploading && (Boolean(text.trim()) || readyIds.length > 0);

  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of [...files]) {
      const localId = `local_${Math.random().toString(36).slice(2)}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setDrafts((d) => [
        ...d,
        {
          id: localId,
          kind: file.type.startsWith("image/") ? "image" : "file",
          name: file.name,
          mime: file.type || "application/octet-stream",
          bytes: file.size,
          sha256: "",
          status: "uploading",
          ...(preview ? { preview } : {}),
        },
      ]);
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

  const send = () => {
    if (!canSend) return;
    props.onSend(text, readyIds);
    setText("");
    for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview);
    setDrafts([]);
  };

  const remove = (id: string) => {
    setDrafts((d) => {
      const hit = d.find((x) => x.id === id);
      if (hit?.preview) URL.revokeObjectURL(hit.preview);
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
        if (props.disabled || props.busy) return;
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      {drafts.length ? (
        <div className="attach-rail" aria-label="Attachments">
          {drafts.map((d) => (
            <div key={d.id} className={`attach-card ${d.kind} ${d.status}`} title={d.error ?? d.name}>
              {d.preview ? <img src={d.preview} alt="" /> : <span className="attach-ext">{d.name.split(".").pop()?.toUpperCase() ?? "FILE"}</span>}
              <div className="attach-meta">
                <div className="attach-name">{d.name}</div>
                <div className="attach-sub">
                  {d.status === "uploading" ? "uploading…" : d.status === "error" ? d.error : formatSize(d.bytes)}
                </div>
              </div>
              <button type="button" className="attach-remove" onClick={() => remove(d.id)} aria-label={`Remove ${d.name}`}>
                ×
              </button>
            </div>
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
        <button
          type="button"
          className="attach-btn"
          disabled={props.disabled || props.busy}
          title="Attach files"
          onClick={() => fileRef.current?.click()}
        >
          +
        </button>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder="Message the agent — Enter to send, Shift+Enter for a new line; drop or paste files"
          disabled={props.disabled}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length === 0 || props.disabled || props.busy) return;
            e.preventDefault();
            void uploadFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            send();
          }}
        />
        {props.busy ? (
          <button className="danger" onClick={props.onStop}>
            Stop
          </button>
        ) : (
          <button className="primary" onClick={send} disabled={!canSend}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
