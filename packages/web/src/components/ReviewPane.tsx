import type { ReviewSnapshot } from "@typescript-agent-harness/cli";
import { useState } from "react";
import { api } from "../api";

const BIND_PROMPT =
  "GitHub PR 或 GitLab MR：URL、owner/repo#n（GitHub）、group/project!iid 或 GitLab MR URL";

function providerLabel(provider: ReviewSnapshot["provider"]): string {
  return provider === "gitlab" ? "GitLab" : "GitHub";
}

function reviewRef(review: ReviewSnapshot): string {
  const base = `${review.owner}/${review.repo}`;
  return review.provider === "gitlab" ? `${base}!${review.number}` : `${base}#${review.number}`;
}

export function ReviewPane(props: {
  review: ReviewSnapshot | undefined;
  onChange(review?: ReviewSnapshot): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const bind = async () => {
    const ref = window.prompt(BIND_PROMPT);
    if (!ref?.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      props.onChange(await api.reviewBind({ ref }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const clear = async () => {
    setPending(true);
    setError(undefined);
    try {
      await api.reviewClear();
      props.onChange(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const review = props.review;
  return (
    <div className="rail-card review-pane">
      <div className="review-head">
        <h2>PR / MR 审阅</h2>
        <div className="review-head-badges">
          {review ? <span className={`review-provider ${review.provider}`}>{providerLabel(review.provider)}</span> : null}
          {review?.state ? <span className={`review-state ${review.state}`}>{review.state}</span> : null}
        </div>
      </div>
      {review ? (
        <>
          <a className="review-title" href={review.url} target="_blank" rel="noreferrer">
            {review.title ?? reviewRef(review)}
          </a>
          <div className="review-ref">{reviewRef(review)}</div>
          {review.body ? <p className="review-body">{review.body}</p> : null}
          <ul className="review-files">
            {review.files.length ? (
              review.files.map((file) => (
                <li key={file.path} title={file.path}>
                  {file.status ? <span>{file.status}</span> : null}
                  {file.path}
                </li>
              ))
            ) : (
              <li className="muted">暂无文件快照</li>
            )}
          </ul>
          {review.diffPreview ? (
            <details className="review-diff">
              <summary>Diff preview</summary>
              <pre>{review.diffPreview}</pre>
            </details>
          ) : null}
          <div className="review-actions">
            <button type="button" className="link" disabled={pending} onClick={bind}>
              重新绑定 PR / MR…
            </button>
            <button type="button" className="link muted" disabled={pending} onClick={clear}>
              清除
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="link" disabled={pending} onClick={bind}>
          {pending ? "绑定中…" : "绑 PR / MR…"}
        </button>
      )}
      {error ? <div className="review-error">{error}</div> : null}
    </div>
  );
}