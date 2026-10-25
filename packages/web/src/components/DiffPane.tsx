import { useEffect, useState } from "react";
import { changeLines, type FileChange } from "../diff-view";
import type { FileTarget } from "../preview-view";

export function DiffPane(props: {
  changes: FileChange[];
  /** Prefer the latest change for this path when opening from the rail. */
  focusPath?: string;
  onOpen(target: FileTarget): void;
  onClose(): void;
}) {
  const focusKey = `${props.focusPath ?? ""}:${props.changes.map((c) => c.id).join(",")}`;
  const [picked, setPicked] = useState<string | undefined>();
  useEffect(() => {
    const focused = props.focusPath
      ? [...props.changes].reverse().find((c) => c.path === props.focusPath)?.id
      : undefined;
    setPicked(focused ?? props.changes.at(-1)?.id);
  }, [focusKey]);
  const current = props.changes.find((c) => c.id === picked) ?? props.changes.at(-1);
  const lines = current ? changeLines(current) : [];

  return (
    <>
      <div className="preview-head">
        <span className="preview-title" title={current?.path}>
          {current ? current.path : "改动"}
        </span>
        {current ? (
          <button type="button" onClick={() => props.onOpen({ path: current.path })}>
            打开文件
          </button>
        ) : null}
        <button type="button" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="preview-body diff-body">
        {props.changes.length === 0 ? (
          <div className="preview-empty">这一轮还没有写入或编辑文件</div>
        ) : (
          <>
            <ul className="diff-list" aria-label="Changes">
              {props.changes.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={c.id === current?.id ? "on" : undefined}
                    onClick={() => setPicked(c.id)}
                  >
                    <span className="diff-kind">{c.kind === "write" ? "写" : "改"}</span>
                    {c.path}
                  </button>
                </li>
              ))}
            </ul>
            <pre className="diff-view">
              {lines.map((line, i) => (
                <div key={i} className={`diff-line ${line.type}`}>
                  {line.text}
                </div>
              ))}
            </pre>
          </>
        )}
      </div>
    </>
  );
}
