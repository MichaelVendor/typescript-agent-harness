import { useRef, useState } from "react";

const CopyIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
    <path d="M10.5 5.5V3.2c0-.7-.5-1.2-1.2-1.2H3.2C2.5 2 2 2.5 2 3.2v6.1c0 .7.5 1.2 1.2 1.2H5.5" strokeLinejoin="round" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Copies `text` (a string, or a function read at click time). */
export function CopyButton({ text }: { text: string | (() => string) }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={copied ? "Copied" : "Copy"}
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        const value = typeof text === "function" ? text() : text;
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
