import type { ServeInfo, WorkspaceView } from "@typescript-agent-harness/cli";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, connect, type Connection } from "./api";
import { ApprovalCard } from "./components/ApprovalCard";
import { Composer } from "./components/Composer";
import { FolderPicker } from "./components/FolderPicker";
import { Messages } from "./components/Messages";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { applyEvent, initialState, type Action } from "./state";

export function App() {
  const [state, dispatch] = useReducer(applyEvent, initialState);
  const [info, setInfo] = useState<ServeInfo>();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>();
  const [sessionsError, setSessionsError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const closePicker = useCallback(() => setPicking(false), []);

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
        },
        onEvent: enqueue,
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
        onNew={(cwd) => run(api.reset(cwd ? { cwd } : {}))}
        onFork={(id, cwd) => run(api.fork({ id, ...(cwd ? { cwd } : {}) }))}
        onPick={(id, cwd) => run(api.resume({ ref: id, cwd }))}
        onRename={async (id, title, cwd) => {
          await api.rename({ id, title, cwd });
          await refresh();
        }}
        onFlag={(id, flag, on, cwd) => run(api.sessionFlag({ id, flag, on, cwd }).then(refresh))}
        onAddFolder={() => setPicking(true)}
        onRemoveFolder={(path) => run(api.removeWorkspace({ path }).then(refresh))}
      />
      {picking ? (
        <FolderPicker
          busy={state.busy}
          onClose={closePicker}
          onOpen={async (path) => {
            await api.addWorkspace({ path });
            await api.reset({ cwd: path });
            setPicking(false);
            await refresh();
          }}
        />
      ) : null}
      <main>
        {connection === "reconnecting" ? <div className="banner">Reconnecting…</div> : null}
        <Messages entries={state.entries}>
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
        <Composer
          cwd={workspaces?.find((w) => w.active)?.path}
          busy={state.busy}
          disabled={connection !== "open" || state.stepLimit}
          onSend={(text, attachmentIds) => run(api.send({ text, attachmentIds }))}
          onStop={() => run(api.cancel())}
        />
        <StatusBar cwd={workspaces?.find((w) => w.active)?.path} model={state.model} sessionId={state.sessionId} rounds={state.rounds} approve={info?.approve ?? true} />
      </main>
    </div>
  );
}
