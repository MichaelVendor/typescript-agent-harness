import type { ServeInfo, SettingsView, WorkspaceView } from "@typescript-agent-harness/cli";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, connect, type Connection } from "./api";
import { ApprovalCard } from "./components/ApprovalCard";
import { Composer } from "./components/Composer";
import { FilePreview } from "./components/FilePreview";
import { TodoPanel } from "./components/TodoPanel";
import { Messages } from "./components/Messages";
import { ModelPicker } from "./components/ModelPicker";
import { NewFolder } from "./components/NewFolder";
import { OpenProject } from "./components/OpenProject";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { touchesFiles, type FileTarget } from "./preview-view";
import { applyEvent, initialState, type Action } from "./state";

export function App() {
  const [state, dispatch] = useReducer(applyEvent, initialState);
  const [info, setInfo] = useState<ServeInfo>();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>();
  const [sessionsError, setSessionsError] = useState<string>();
  const [dialog, setDialog] = useState<"open" | "new" | "settings">();
  const [settings, setSettings] = useState<SettingsView>();
  const [preview, setPreview] = useState<FileTarget>();
  const [previewVersion, setPreviewVersion] = useState(0);
  const closePreview = useCallback(() => setPreview(undefined), []);
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
          enqueue(event);
          if (touchesFiles(event)) setPreviewVersion((v) => v + 1);
        },
        onStatus: setConnection,
      });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [enqueue]);

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

  useEffect(() => setPreview(undefined), [state.sessionId]);

  const openFolder = async (path: string) => {
    await api.addWorkspace({ path });
    await api.reset({ cwd: path });
    setDialog(undefined);
    await refresh();
  };

  const run = (pending: Promise<unknown>) =>
    pending.catch((err: unknown) => enqueue({ type: "local.error", text: err instanceof Error ? err.message : String(err) }));

  if (connection === "signed-out") {
    return (
      <div className="signed-out">
        Open the link <code>tah serve</code> printed in your terminal to sign in.
      </div>
    );
  }

  const last = state.entries.at(-1);
  const toolRunning = state.entries.some((e) => e.kind === "tool" && e.status === "running");
  const thinking = state.busy && !state.approval && !toolRunning && last?.kind !== "assistant";

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        unavailable={sessionsError}
        current={state.sessionId}
        busy={state.busy}
        approval={Boolean(state.approval)}
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
        {connection === "reconnecting" ? <div className="banner">Reconnecting…</div> : null}
        <Messages entries={state.entries} busy={state.busy} onOpen={setPreview}>
          {thinking ? (
            <div className="thinking">
              <span className="spinner" /> thinking…
            </div>
          ) : null}
          {state.approval ? (
            <ApprovalCard
              approval={state.approval}
              onAnswer={(answer) => state.approval && run(api.answer({ id: state.approval.id, answer }))}
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
                    run(api.continueTurn());
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
        <Composer
          cwd={workspaces?.find((w) => w.active)?.path}
          busy={state.busy}
          disabled={connection !== "open" || state.stepLimit}
          onSend={(text, attachmentIds) => run(api.send({ text, attachmentIds }))}
          onStop={() => run(api.cancel())}
        >
          <ModelPicker
            view={settings}
            busy={state.busy}
            onPick={(id) => run(api.activeModel({ id }).then(setSettings))}
            onManage={() => setDialog("settings")}
          />
        </Composer>
        <StatusBar
          cwd={workspaces?.find((w) => w.active)?.path}
          sessionId={state.sessionId}
          rounds={state.rounds}
          approve={info?.approve ?? true}
          onCompact={
            connection === "open" && !state.busy && !state.stepLimit
              ? () => {
                  enqueue({ type: "local.continue" });
                  run(api.compact());
                }
              : undefined
          }
        />
      </main>
      {preview ? (
        <FilePreview target={preview} version={previewVersion} onOpen={setPreview} onClose={closePreview} />
      ) : null}
    </div>
  );
}
