import type { HostEvent, ReviewSnapshot, ServeInfo, SettingsView, WorkerInfo, WorkspaceView } from "@typescript-agent-harness/cli";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, ApiError, connect, type Connection } from "./api";
import { agentBrowsing, opensBrowser } from "./browser-view";
import { ApprovalCard } from "./components/ApprovalCard";
import { QuestionCard } from "./components/QuestionCard";
import { BrowserPane } from "./components/BrowserPane";
import { Composer } from "./components/Composer";
import { DiffPane } from "./components/DiffPane";
import { QueueList } from "./components/QueueList";
import { FilePreview } from "./components/FilePreview";
import { TodoPanel } from "./components/TodoPanel";
import { ReviewTicketsPanel, useSuperAgentPanel } from "./components/ReviewTicketsPanel";
import { ReviewPane } from "./components/ReviewPane";
import { Messages } from "./components/Messages";
import { ModelPicker } from "./components/ModelPicker";
import { NewFolder } from "./components/NewFolder";
import { OpenProject } from "./components/OpenProject";
import { Settings } from "./components/Settings";
import { SessionStatus } from "./components/SessionStatus";
import { SidePanel } from "./components/SidePanel";
import { Sidebar } from "./components/Sidebar";
import { contextPercent } from "./context-usage";
import { fileChanges } from "./diff-view";
import { fileQuery, touchesFiles, type FileTarget } from "./preview-view";
import { applyEvent, initialState, type Action, type Attention, type Entry } from "./state";
import { clearUnread, loadUnread, markUnread } from "./unread";

function workerLabel(w: WorkerInfo): string {
  if (w.worktree?.name) return w.worktree.name;
  if (w.id === "main") return "main";
  return w.id.slice(0, 8);
}

function isHostEvent(event: Action): event is HostEvent {
  return event.type !== "batch" && event.type !== "attention" && event.type !== "workers" && !event.type.startsWith("local.");
}

function sessionTitle(entries: Entry[]): string {
  for (const e of entries) if (e.kind === "user" && e.text) return e.text;
  return "新会话";
}

const MODES = ["manual", "accept-edits", "plan"] as const;
type Mode = (typeof MODES)[number];
const MODE_LABEL: Record<Mode, string> = { manual: "手动", "accept-edits": "接受编辑", plan: "计划" };
const MODE_TITLE: Record<Mode, string> = {
  manual: "改文件和跑命令前先问",
  "accept-edits": "改文件直接执行，命令仍要问",
  plan: "不改文件，不跑命令",
};

type Suggestion = { label: string; send: string; detail?: string };

function followUp(entries: Entry[], busy: boolean): string | undefined {
  if (busy) return undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.kind === "user") break;
    if (e?.kind === "tool" && e.path && e.status === "ok") return "看一下刚才的改动";
  }
  return undefined;
}

function SessionRail(props: {
  tokens: { promptTokens: number; completionTokens: number } | undefined;
  percent: number | undefined;
  paths: string[];
  running: string[];
  thinking: boolean;
  onOpenDiff(path?: string): void;
  onCompact: (() => void) | undefined;
  /** When true, show read-only Super-agent ticket card (polls separately). */
  superAgentPanel?: boolean;
  workers: WorkerInfo[];
  focusId: string;
  attention: Attention[];
  onFocusWorker(id: string): void;
  onRemoveWorker(id: string): void;
  onParallel: (() => void) | undefined;
  unread: Record<string, true>;
  /** Bumps when turn/approval/focus changes so SessionStatus refetches. */
  statusKey: string | number;
  review: ReviewSnapshot | undefined;
  onReviewChange(review?: ReviewSnapshot): void;
}) {
  const tokens = props.tokens;
  const used = tokens ? tokens.promptTokens + tokens.completionTokens : 0;
  const panel = useSuperAgentPanel(props.superAgentPanel === true);
  const attentionOf = (id: string) => props.attention.find((a) => a.workerId === id);
  return (
    <aside className="session-rail">
      <SessionStatus refreshKey={props.statusKey} />
      <ReviewPane review={props.review} onChange={props.onReviewChange} />
      {props.workers.length > 0 ? (
        <div className="rail-card">
          <h2>Workers</h2>
          <ul className="worker-list">
            {props.workers.map((w) => {
              const att = attentionOf(w.id) ?? (w.needsAttention ? { kind: "approval" as const, summary: "needs attention" } : undefined);
              const focused = w.id === props.focusId;
              return (
                <li key={w.id} className="worker-item">
                  <button
                    type="button"
                    className={focused ? "worker-row on" : "worker-row"}
                    title={w.cwd}
                    onClick={() => props.onFocusWorker(w.id)}
                  >
                    {props.unread[w.id] && !focused ? (
                      <span className="worker-unread-dot" aria-label="未读" title="有新活动" />
                    ) : null}
                    <span className="worker-name">{workerLabel(w)}</span>
                    {w.pendingWorktree ? (
                      <span className="worker-chip pending" title="首条消息后再创建 worktree">
                        pending
                      </span>
                    ) : null}
                    {w.dead ? <span className="worker-chip dead">dead</span> : null}
                    {w.busy && !att ? <span className="spinner" aria-label="busy" /> : null}
                    {att ? (
                      <span className="worker-chip attention" title={att.summary}>
                        {att.kind === "approval" ? "审批" : "提问"}
                      </span>
                    ) : null}
                  </button>
                  {w.dead ? (
                    <button type="button" className="link" onClick={() => props.onRemoveWorker(w.id)}>
                      Remove
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {props.onParallel ? (
            <button
              type="button"
              className="link"
              title="Creates a worktree on first send"
              onClick={props.onParallel}
            >
              新建 worktree 并行
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="rail-card">
        <h2>上下文</h2>
        {props.percent !== undefined ? (
          <>
            <div className="rail-meter" aria-label={`已用约 ${props.percent}%`}>
              <span style={{ width: `${props.percent}%` }} />
            </div>
            <div className="rail-usage">
              约 {props.percent}%
              {tokens && used > 0
                ? ` · in ${tokens.promptTokens.toLocaleString("en-US")} · out ${tokens.completionTokens.toLocaleString("en-US")}`
                : ""}
            </div>
          </>
        ) : (
          "这一轮还没有用量"
        )}
        {props.onCompact ? (
          <button type="button" className="link" onClick={props.onCompact}>
            压缩上下文
          </button>
        ) : null}
      </div>
      <div className="rail-card">
        <h2>改动</h2>
        {props.paths.length
          ? props.paths.slice(-6).map((path) => (
              <button type="button" className="link" key={path} title={path} onClick={() => props.onOpenDiff(path)}>
                {path.split(/[/\\]/).at(-1)}
              </button>
            ))
          : "还没有改文件"}
        {props.paths.length ? (
          <button type="button" className="link" onClick={() => props.onOpenDiff()}>
            查看全部
          </button>
        ) : null}
      </div>
      <div className="rail-card">
        <h2>正在跑</h2>
        {props.running.length ? props.running.join(" · ") : props.thinking ? "思考中" : "空闲"}
      </div>
      {props.superAgentPanel ? <ReviewTicketsPanel panel={panel} /> : null}
    </aside>
  );
}

export function App() {
  const [state, dispatch] = useReducer(applyEvent, initialState);
  const [info, setInfo] = useState<ServeInfo>();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>();
  const [sessionsError, setSessionsError] = useState<string>();
  const [dialog, setDialog] = useState<"open" | "new" | "settings">();
  const [settings, setSettings] = useState<SettingsView>();
  const [review, setReview] = useState<ReviewSnapshot>();
  const [preview, setPreview] = useState<FileTarget>();
  const [previewVersion, setPreviewVersion] = useState(0);
  const closePreview = useCallback(() => setPreview(undefined), []);
  const [browserShown, setBrowserShown] = useState(false);
  const [browserAvailable, setBrowserAvailable] = useState(false);
  const [view, setView] = useState<"file" | "browser" | "diff">("file");
  const [mode, setMode] = useState<Mode>("manual");
  const [expandTools, setExpandTools] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffFocus, setDiffFocus] = useState<string>();
  const openFile = useCallback((target: FileTarget) => {
    setDiffOpen(false);
    setPreview(target);
    setView("file");
  }, []);
  const showBrowser = useCallback(() => {
    setBrowserShown(true);
    setView("browser");
  }, []);
  const closeDialog = useCallback(() => setDialog(undefined), []);

  // Streamed deltas arrive far faster than the screen refreshes: render at most once per frame.
  const queue = useRef<Action[]>([]);
  const frame = useRef(0);
  const enqueue = useCallback((action: Action) => {
    queue.current.push(action);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      dispatch({ type: "batch", actions: queue.current.splice(0) });
    });
  }, []);

  const tahOrigin = typeof location !== "undefined" ? location.origin : "";
  const [unreadTick, setUnreadTick] = useState(0);
  const unread = useMemo(() => loadUnread(tahOrigin), [tahOrigin, unreadTick]);
  const bumpUnread = useCallback(() => setUnreadTick((n) => n + 1), []);
  const focusIdRef = useRef(state.focusId);
  const workersBusyRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    focusIdRef.current = state.focusId;
  }, [state.focusId]);

  const applyUnreadFromEvent = useCallback(
    (event: Action) => {
      const focus = focusIdRef.current;
      let touched = false;
      if (event.type === "attention" && event.workerId !== focus) {
        markUnread(tahOrigin, event.workerId);
        touched = true;
      } else if (event.type === "turn.end") {
        const wid = "workerId" in event && typeof event.workerId === "string" ? event.workerId : undefined;
        if (wid && wid !== focus) {
          markUnread(tahOrigin, wid);
          touched = true;
        }
      } else if (event.type === "workers") {
        clearUnread(tahOrigin, event.focusId);
        touched = true;
        for (const w of event.workers) {
          if (w.id !== event.focusId && workersBusyRef.current.get(w.id) === true && !w.busy) {
            markUnread(tahOrigin, w.id);
          }
          workersBusyRef.current.set(w.id, w.busy);
        }
      }
      if (touched) bumpUnread();
    },
    [tahOrigin, bumpUnread],
  );

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const token = new URLSearchParams(location.search).get("token");
    if (token) history.replaceState(null, "", location.pathname);
    (token ? api.auth({ token }).catch(() => {}) : Promise.resolve()).then(() => {
      if (cancelled) return;
      stop = connect({
        onOpen() {
          // Do not wipe state here: SSE may deliver the session replay in the same tick,
          // and a trailing reset would leave the transcript blank.
          api.info().then(setInfo, () => {});
          api.settings().then(setSettings, () => {});
        },
        onEvent(event) {
          applyUnreadFromEvent(event as Action);
          enqueue(event as Action);
          if (isHostEvent(event as Action) && touchesFiles(event as HostEvent)) setPreviewVersion((v) => v + 1);
          if (isHostEvent(event as Action) && opensBrowser(event as HostEvent)) showBrowser();
        },
        onStatus: setConnection,
      });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [enqueue, showBrowser, applyUnreadFromEvent]);

  const refresh = useCallback(
    () =>
      api.workspaces().then(
        (rows) => {
          setWorkspaces(rows);
          setSessionsError(undefined);
        },
        (err: unknown) => setSessionsError(err instanceof Error ? err.message : String(err)),
      ),
    [],
  );

  useEffect(() => {
    if (connection !== "open" || state.busy) return;
    void refresh();
  }, [connection, state.busy, state.sessionId, state.turnsEnded, refresh]);

  useEffect(() => {
    setPreview(undefined);
    setDiffOpen(false);
    setDiffFocus(undefined);
    setExpandTools(false);
  }, [state.sessionId]);

  const openDiff = useCallback((path?: string) => {
    setDiffFocus(path);
    setDiffOpen(true);
    setView("diff");
  }, []);

  const activeModelName = useMemo(() => {
    if (!settings) return undefined;
    const id = settings.activeModel;
    if (id) return settings.models.find((m) => m.id === id)?.model;
    return settings.env?.model;
  }, [settings]);

  const activePath = workspaces?.find((w) => w.active)?.path;
  useEffect(() => {
    setMode("manual");
    if (!activePath) return;
    void api.mode({ mode: "manual" }).catch(() => {});
  }, [activePath]);

  useEffect(() => {
    if (connection !== "open") return;
    let stop = false;
    const load = () => {
      void api.suggestions().then(
        (rows) => {
          if (!stop) setSuggestions(rows);
        },
        () => {
          if (!stop) setSuggestions([]);
        },
      );
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [connection, activePath]);

  useEffect(() => {
    if (connection !== "open") return;
    let cancelled = false;
    setReview(undefined);
    void api.review().then(
      (snapshot) => {
        if (!cancelled) setReview(snapshot);
      },
      (err: unknown) => {
        if (!cancelled && err instanceof ApiError && err.status === 404) setReview(undefined);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection, activePath]);

  useEffect(() => {
    if (connection !== "open") return;
    let cancelled = false;
    api.browserState().then(
      (s) => {
        if (!cancelled) setBrowserAvailable(s.available);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [connection, state.sessionId]);

  const openFolder = async (path: string) => {
    await api.addWorkspace({ path });
    await api.reset({ cwd: path });
    setDialog(undefined);
    await refresh();
  };

  const run = (pending: Promise<unknown>) =>
    pending.catch((err: unknown) => enqueue({ type: "local.error", text: err instanceof Error ? err.message : String(err) }));

  const focusWorker = useCallback(
    (id: string) => {
      clearUnread(tahOrigin, id);
      bumpUnread();
      run(api.workersFocus({ id }));
    },
    [tahOrigin, bumpUnread, run],
  );

  const withWorker = <T extends Record<string, unknown>>(body: T): T & { workerId?: string } =>
    state.focusId ? { ...body, workerId: state.focusId } : body;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "o" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setExpandTools((v) => !v);
        return;
      }
      if (e.key !== "Escape" || dialog) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (state.busy) {
        e.preventDefault();
        const body = state.focusId ? { workerId: state.focusId } : {};
        void api.cancel(body).catch((err: unknown) =>
          enqueue({ type: "local.error", text: err instanceof Error ? err.message : String(err) }),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, state.busy, state.focusId, enqueue]);

  const browse = useMemo(
    () =>
      browserAvailable
        ? (url: string) => {
            showBrowser();
            run(api.browserOpen({ url }));
          }
        : undefined,
    // `run` only wraps `enqueue`.
    [browserAvailable, showBrowser, enqueue],
  );

  if (connection === "signed-out") {
    return (
      <div className="signed-out">
        Open the link <code>tah serve</code> printed in your terminal to sign in.
      </div>
    );
  }

  const last = state.entries.at(-1);
  const toolRunning = state.entries.some((e) => e.kind === "tool" && e.status === "running");
  const thinking = state.busy && !state.approval && !state.question && !toolRunning && last?.kind !== "assistant";
  const changes = fileChanges(state.entries);
  const answerLocked = (workerId: string | undefined) =>
    Boolean(state.focusId && workerId && workerId !== state.focusId);
  const attentionBanner = state.attention.find((a) => a.workerId !== state.focusId);
  const fileOpen = preview !== undefined;
  const browserOpen = browserShown && browserAvailable;
  const side = diffOpen
    ? "diff"
    : fileOpen && browserOpen
      ? view === "diff"
        ? "file"
        : view
      : fileOpen
        ? "file"
        : browserOpen
          ? "browser"
          : undefined;

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        unavailable={sessionsError}
        current={state.sessionId}
        busy={state.busy}
        waiting={state.approval ? "needs approval" : state.question ? "needs answer" : undefined}
        onNew={(cwd) => run(api.reset(cwd ? { cwd } : {}))}
        onFork={(id, cwd) => run(api.fork({ id, ...(cwd ? { cwd } : {}) }))}
        onPick={(id, cwd) => run(api.resume({ ref: id, cwd }))}
        onRename={async (id, title, cwd) => {
          await api.rename({ id, title, cwd });
          await refresh();
        }}
        onFlag={(id, flag, on, cwd) => run(api.sessionFlag({ id, flag, on, cwd }).then(refresh))}
        onOpenProject={() => setDialog("open")}
        onNewFolder={() => setDialog("new")}
        onRemoveFolder={(path) => run(api.removeWorkspace({ path }).then(refresh))}
        user={settings?.user}
        onSettings={() => setDialog("settings")}
      />
      {dialog === "settings" && settings ? (
        <Settings busy={state.busy} view={settings} onChange={setSettings} onClose={closeDialog} />
      ) : null}
      {dialog === "open" ? <OpenProject busy={state.busy} onClose={closeDialog} onOpen={openFolder} /> : null}
      {dialog === "new" && info ? (
        <NewFolder busy={state.busy} desktop={info.desktop} onClose={closeDialog} onOpen={openFolder} />
      ) : null}
      <main>
        <div className="session-head">
          <span className="session-name">
            {sessionTitle(state.entries)}
          </span>
          <div className="panes">
            <button
              type="button"
              className={!side ? "on" : ""}
              onClick={() => {
                closePreview();
                setBrowserShown(false);
                setDiffOpen(false);
              }}
            >
              聊天
            </button>
            <button type="button" className={side === "diff" ? "on" : ""} onClick={() => openDiff()}>
              改动
            </button>
            <button
              type="button"
              className={side === "file" ? "on" : ""}
              onClick={() => {
                if (!fileOpen) return;
                setDiffOpen(false);
                setView("file");
              }}
            >
              预览
            </button>
            <button type="button" className={side === "browser" ? "on" : ""} onClick={showBrowser} disabled={!browserAvailable}>
              浏览器
            </button>
          </div>
        </div>
        {connection === "reconnecting" ? <div className="banner">Reconnecting…</div> : null}
        {attentionBanner ? (
          <div className="banner attention">
            <button type="button" className="link" onClick={() => focusWorker(attentionBanner.workerId)}>
              {attentionBanner.kind === "approval" ? "审批" : "提问"} · {attentionBanner.summary}
            </button>
            <span> — 点击切换焦点</span>
          </div>
        ) : null}
        <Messages entries={state.entries} busy={state.busy} onOpen={openFile} onBrowse={browse} expandTools={expandTools}>
          {state.retry ? (
            <div className="thinking retry">
              <span className="spinner" /> {state.retry}
            </div>
          ) : thinking ? (
            <div className="thinking">
              <span className="spinner" /> thinking…
            </div>
          ) : null}
          {state.approval ? (
            <ApprovalCard
              approval={state.approval}
              disabled={answerLocked(state.approval.workerId)}
              onAnswer={(answer) =>
                state.approval && run(api.answer(withWorker({ id: state.approval.id, answer })))
              }
            />
          ) : null}
          {state.question ? (
            <QuestionCard
              key={state.question.id}
              question={state.question}
              disabled={answerLocked(state.question.workerId)}
              onAnswer={(answers) =>
                state.question && run(api.question(withWorker({ id: state.question.id, answers })))
              }
              onSkip={() =>
                state.question && run(api.question(withWorker({ id: state.question.id, skip: true as const })))
              }
            />
          ) : null}
          {state.stepLimit && !state.busy ? (
            <div className="card">
              <div className="card-title">
                Step limit reached{info?.maxSteps ? ` (${info.maxSteps} rounds this turn)` : ""}.
              </div>
              <div className="card-actions">
                <button
                  className="primary"
                  onClick={() => {
                    enqueue({ type: "local.continue" });
                    run(api.continueTurn(withWorker({})));
                  }}
                >
                  Continue
                </button>
                <button onClick={() => enqueue({ type: "local.dismiss" })}>Stop</button>
              </div>
            </div>
          ) : null}
        </Messages>
        <TodoPanel todos={state.todos} />
        <QueueList
          items={state.queue}
          busy={state.busy}
          onSend={(id) => run(api.queue(withWorker({ id, send: true as const })))}
          onRemove={(id) => run(api.queue(withWorker({ id, remove: true as const })))}
        />
        {review ? (
          <div className="review-notice">
            Reviewing {review.owner}/{review.repo}#{review.number}
          </div>
        ) : null}
        <Composer
          cwd={activePath}
          mode={
            info
              ? info.approve
                ? {
                    label: MODE_LABEL[mode],
                    title: MODE_TITLE[mode],
                    onCycle: () => {
                      const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? "manual";
                      setMode(next);
                      run(api.mode({ mode: next }));
                    },
                  }
                : { label: "直接执行", title: "启动时带了 --yes，不再询问" }
              : undefined
          }
          suggestion={followUp(state.entries, state.busy)}
          suggestions={suggestions}
          busy={state.busy}
          disabled={connection !== "open" || state.stepLimit}
          allowAttachments={!(state.focusId && state.focusId !== "main")}
          onSend={(text, attachmentIds) => run(api.send(withWorker({ text, attachmentIds })))}
          onStop={() => run(api.cancel(withWorker({})))}
          onCommand={(cmd) => {
            if (cmd === "compact") {
              enqueue({ type: "local.continue" });
              run(api.compact(withWorker({})));
            } else if (cmd === "reset") run(api.reset({}));
            else if (cmd === "fork") run(api.fork({}));
          }}
        >
          <ModelPicker
            view={settings}
            busy={state.busy}
            onPick={(id) => run(api.activeModel({ id }).then(setSettings))}
            onManage={() => setDialog("settings")}
          />
        </Composer>
      </main>
      {side ? null : (
        <SessionRail
          tokens={state.tokens}
          percent={contextPercent(state.tokens, activeModelName)}
          paths={[...new Set(state.entries.flatMap((e) => (e.kind === "tool" && e.path ? [e.path] : [])))]}
          running={
            state.entries.flatMap((e) => (e.kind === "tool" && e.status === "running" ? [e.summary || e.tool] : []))
          }
          thinking={thinking}
          onOpenDiff={openDiff}
          onCompact={
            connection === "open" && !state.busy && !state.stepLimit
              ? () => {
                  enqueue({ type: "local.continue" });
                  run(api.compact(withWorker({})));
                }
              : undefined
          }
          superAgentPanel={info?.superAgentPanel === true}
          workers={state.workers}
          focusId={state.focusId}
          attention={state.attention}
          onFocusWorker={focusWorker}
          unread={unread}
          onRemoveWorker={(id) => run(api.workersRemove({ id }))}
          onParallel={
            connection === "open" && state.workers.length > 0
              ? () => run(api.workersParallel({ deferUntilSend: true }))
              : undefined
          }
          statusKey={`${state.turnsEnded}:${state.busy}:${state.approval?.id ?? ""}:${state.question?.id ?? ""}:${state.focusId}:${state.workers.length}`}
          review={review}
          onReviewChange={setReview}
        />
      )}
      {side ? (
        <SidePanel
          view={side === "diff" ? "file" : side}
          both={fileOpen && browserOpen && side !== "diff"}
          onView={(v) => {
            setDiffOpen(false);
            setDiffFocus(undefined);
            setView(v);
          }}
        >
          {side === "diff" ? (
            <DiffPane
              changes={changes}
              focusPath={diffFocus}
              onOpen={(target) => {
                setDiffOpen(false);
                setDiffFocus(undefined);
                openFile(target);
              }}
              onClose={() => {
                setDiffOpen(false);
                setDiffFocus(undefined);
              }}
            />
          ) : side === "file" && preview ? (
            <FilePreview
              key={fileQuery(preview)}
              target={preview}
              version={previewVersion}
              onOpen={openFile}
              onBrowse={browse}
              onClose={closePreview}
            />
          ) : (
            <BrowserPane agentBusy={agentBrowsing(state.entries)} onClose={() => setBrowserShown(false)} />
          )}
        </SidePanel>
      ) : null}
    </div>
  );
}
