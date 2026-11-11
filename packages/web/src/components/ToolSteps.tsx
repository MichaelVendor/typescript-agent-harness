import { useEffect, useState } from "react";
import type { FileTarget } from "../preview-view";
import type { ToolEntry } from "../tool-runs";
import { ToolLine } from "./ToolLine";

/** Collapsed step group → timeline list → per-tool detail (no white cards). */
export function ToolSteps(props: {
  tools: ToolEntry[];
  expandAll: boolean;
  onOpen?(target: FileTarget): void;
}) {
  const { tools, expandAll, onOpen } = props;
  const anyRunning = tools.some((t) => t.status === "running");
  const anyFailed = tools.some((t) => t.status === "failed");
  const [open, setOpen] = useState(() => expandAll || anyRunning || anyFailed);

  useEffect(() => {
    if (expandAll || anyRunning || anyFailed) setOpen(true);
  }, [expandAll, anyRunning, anyFailed]);

  const n = tools.length;
  return (
    <div className="steps">
      <button
        type="button"
        className="steps-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="steps-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="steps-title">步骤</span>
        <span className="steps-detail">
          {n} 个工具
          {anyFailed ? " · 有失败" : ""}
        </span>
        {anyRunning ? <span className="spinner" aria-label="running" /> : null}
      </button>
      {open ? (
        <div className="steps-body">
          {tools.map((t) => (
            <ToolLine
              key={t.id}
              tool={t.tool}
              summary={t.summary}
              status={t.status}
              result={t.result}
              expandAll={expandAll}
              {...(t.path ? { path: t.path } : {})}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
