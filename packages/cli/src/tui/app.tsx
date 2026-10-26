import { Box, Text, useApp, useBoxMetrics, useCursor, useInput, usePaste, useWindowSize } from "ink";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatContinuePrompt, formatPrompt } from "../approve.js";
import type { Question } from "../ask-user.js";
import type { ChatHost } from "../host.js";
import { cycleMode, type PermissionMode } from "../permission-mode.js";
import { matchFiles } from "../serve/files.js";
import type { SessionRow } from "../sessions.js";
import { matchCommands, parseCommand, type ParsedCommand, type SlashCommand } from "./commands.js";
import {
  backspace,
  deleteForward,
  editorText,
  emptyEditor,
  insert,
  isBlank,
  layoutEditor,
  move,
  moveWord,
  slashQuery,
  yank,
  type Editor,
} from "./editor.js";
import { editInEditor } from "./external-editor.js";
import { ingestClipboard, pastedImagePaths } from "./clipboard.js";
import { splitImage } from "./images.js";
import { createPromptHistory } from "./prompt-history.js";
import {
  applyKill,
  cycleStash,
  fileMentionQuery,
  footerHint,
  historyKeyAction,
  insertFileMention,
  latestTodos,
  toggleTranscript,
  type AppMode,
  type Stash,
} from "./shortcuts.js";
import { panelSend, type TuiCtx, type TuiModule } from "./modules.js";
import { PANEL_ROWS, TuiPanel } from "./panel.js";
import { formatToolResult } from "./tool-result.js";
import type { Item, RunningTool, Snapshot, Transcript } from "./transcript.js";

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const PICKER_ROWS = 10;
/** Border + padding + "> " to the left of the text. */
const INPUT_INSET = 4;

/** The plain-mode prompts end with "›" where the answer is typed; the TUI reads keys instead. */
const withoutAnswerMark = (s: string) => s.replace(/^\n+/, "").replace(/\s*(\x1b\[\d+m)?›(\x1b\[\d+m)?\s*$/, "");

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, []);
  return <Text color="cyan">{SPINNER[frame]}</Text>;
}

const MODE_LABEL: Record<PermissionMode, string> = { manual: "手动", "accept-edits": "接受编辑", plan: "计划" };

function ToolLine(props: {
  tool: string;
  summary: string;
  status: "running" | "ok" | "failed";
  result?: string;
  open?: boolean;
  color?: boolean;
}) {
  const failed = props.status === "failed";
  const showResult = props.status !== "running" && (props.open || failed);
  const open = Boolean(props.open);
  const result = showResult
    ? formatToolResult(props.result ?? "", props.color ? { open, color: true } : { open })
    : "";
  return (
    <Box flexDirection="column">
      <Text>
        {failed ? <Text color="red">⏺ </Text> : <Text>⏺ </Text>}
        <Text bold>{props.tool}</Text>
        {props.summary ? <Text dimColor>{`(${props.summary})`}</Text> : null}
        {props.status === "running" ? " " : null}
        {props.status === "running" ? <Spinner /> : null}
      </Text>
      {showResult ? <ToolResult result={result} failed={failed} color={Boolean(props.color)} /> : null}
    </Box>
  );
}

/** Diff lines keep the helper's SGR; other lines stay red when failed and dim otherwise. */
function ToolResult({ result, failed, color }: { result: string; failed: boolean; color: boolean }) {
  if (!color) {
    return failed ? <Text color="red">{`  ⎿  ${result}`}</Text> : <Text dimColor>{`  ⎿  ${result}`}</Text>;
  }
  return (
    <Box flexDirection="column">
      {result.split("\n").map((line, i) => {
        const row = i === 0 ? `  ⎿  ${line}` : line;
        if (line.startsWith("\x1b")) return <Text key={i}>{row}</Text>;
        return failed ? (
          <Text key={i} color="red">{row}</Text>
        ) : (
          <Text key={i} dimColor>{row}</Text>
        );
      })}
    </Box>
  );
}

/** `raw` (Kitty/Sixel/iTerm) can't pass through Ink's text filter, so it is written once, when the item first shows. */
function ItemImages({ images }: { images: string }) {
  const { text, raw } = splitImage(images);
  useLayoutEffect(() => {
    if (raw) process.stdout.write(raw);
  }, []);
  return <Text>{text}</Text>;
}

/** Claude Code dark preset `userMessageBackground`: rgb(55, 55, 55). */
function UserBar({ text }: { text: string }) {
  const { columns } = useWindowSize();
  return (
    <Box width={columns} marginTop={1} backgroundColor="#373737" paddingX={1}>
      <Text color="white">{text}</Text>
    </Box>
  );
}

function itemLines(item: Item, open: boolean): number {
  if (item.kind === "assistant") {
    const n = Math.max(1, item.text.split("\n").length);
    return open && item.model ? n + 1 : n;
  }
  if (item.kind === "user") return 2;
  if (item.kind === "tool") {
    if (!(open || !item.ok)) return 1;
    return 1 + formatToolResult(item.result, { open }).split("\n").length;
  }
  if (item.kind === "todos") return Math.max(1, item.todos.length);
  return 1;
}

function clipItem(item: Item, take: number, open: boolean): Item {
  if (item.kind !== "assistant") return item;
  const extra = open && item.model ? 1 : 0;
  const textTake = Math.max(0, take - extra);
  const lines = item.text.split("\n");
  if (lines.length <= textTake) return item;
  return { ...item, text: lines.slice(lines.length - textTake).join("\n") };
}

/** The last lines that fit above the pinned input. `scroll` hides that many lines from the tail. */
function windowItems(items: Item[], capacity: number, scroll: number, open: boolean): Item[] {
  let skip = scroll;
  const picked: { item: Item; take: number }[] = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0 && used < capacity; i--) {
    const item = items[i];
    if (!item) continue;
    const n = itemLines(item, open);
    if (skip >= n) {
      skip -= n;
      continue;
    }
    const take = Math.min(n - skip, capacity - used);
    skip = 0;
    picked.push({ item, take });
    used += take;
  }
  return picked.reverse().map(({ item, take }) => clipItem(item, take, open));
}

function liveLines(snap: Snapshot): number {
  const streamed = snap.live ? snap.live.split("\n").length : 0;
  const thinking = snap.retry || (snap.busy && !snap.live && snap.tools.length === 0 && !snap.approval) ? 1 : 0;
  return streamed + snap.tools.length + thinking;
}

function HistoryItem({ item, open, color }: { item: Item; open: boolean; color: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <Box flexDirection="column">
          <UserBar text={item.text} />
          {item.images ? <ItemImages images={item.images} /> : null}
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column">
          <Text>{`⏺ ${item.text || " "}`}</Text>
          {open && item.model ? <Text dimColor>{item.model}</Text> : null}
          {item.images ? <ItemImages images={item.images} /> : null}
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column">
          <ToolLine
            tool={item.tool}
            summary={item.summary}
            status={item.ok ? "ok" : "failed"}
            result={item.result}
            open={open}
            color={color}
          />
          {item.images ? <ItemImages images={item.images} /> : null}
        </Box>
      );
    case "todos":
      return (
        <Box flexDirection="column" marginLeft={2}>
          {item.todos.map((t, i) =>
            t.status === "completed" ? (
              <Text key={i} dimColor strikethrough>{`☑ ${t.content}`}</Text>
            ) : t.status === "in_progress" ? (
              <Text key={i} bold>{`▶ ${t.content}`}</Text>
            ) : (
              <Text key={i}>{`☐ ${t.content}`}</Text>
            ),
          )}
        </Box>
      );
    case "notice":
      return <Text dimColor>{item.text}</Text>;
    case "error":
      return <Text color="red">{item.text}</Text>;
  }
}

function Live({ snap, maxLines }: { snap: Snapshot; maxLines: number }) {
  const lines = snap.live ? snap.live.split("\n") : [];
  const shown = lines.slice(-maxLines);
  return (
    <Box flexDirection="column">
      {shown.length ? <Text>{shown.join("\n")}</Text> : null}
      {snap.tools.map((t: RunningTool) => (
        <ToolLine key={t.callId} tool={t.tool} summary={t.summary} status="running" />
      ))}
      {snap.retry ? (
        <Text color="#e8a87c">
          ✢ {snap.retry}
        </Text>
      ) : snap.busy && !snap.live && snap.tools.length === 0 && !snap.approval ? (
        <Text color="#e8a87c">✢ thinking…</Text>
      ) : null}
    </Box>
  );
}

const MENU_ROWS = 8;

function windowStart(index: number, length: number): number {
  return Math.max(0, Math.min(index - MENU_ROWS + 1, length - MENU_ROWS));
}

function FileMenu({ files, index }: { files: string[]; index: number }) {
  const start = windowStart(index, files.length);
  return (
    <Box flexDirection="column" paddingX={1}>
      {files.slice(start, start + MENU_ROWS).map((file, i) => (
        <Text key={file} inverse={start + i === index} wrap="truncate">{file}</Text>
      ))}
    </Box>
  );
}

function HistorySearch({ query, matches, index }: { query: string; matches: string[]; index: number }) {
  const start = windowStart(index, matches.length);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>{`bck-i-search: ${query}`}</Text>
      {matches.slice(start, start + MENU_ROWS).map((line, i) => (
        <Text key={`${start + i}:${line}`} inverse={start + i === index} wrap="truncate">{line}</Text>
      ))}
    </Box>
  );
}

function HelpBlock() {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>Ctrl+O transcript · Ctrl+R history · Ctrl+G editor · Ctrl+T todos</Text>
      <Text dimColor>Ctrl+S stash · Ctrl+L redraw · Ctrl+K/U/W/Y kill/yank · Alt+B/F word</Text>
    </Box>
  );
}

function TodosBar({ todos }: { todos: readonly { content: string; status: string }[] }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>Todos</Text>
      {todos.map((t, i) =>
        t.status === "completed" ? (
          <Text key={i} dimColor strikethrough>{`☑ ${t.content}`}</Text>
        ) : t.status === "in_progress" ? (
          <Text key={i} bold>{`▶ ${t.content}`}</Text>
        ) : (
          <Text key={i}>{`☐ ${t.content}`}</Text>
        ),
      )}
    </Box>
  );
}

function Menu({ matches, index }: { matches: SlashCommand[]; index: number }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {matches.map((c, i) => (
        <Text key={c.name} inverse={i === index}>
          {`${c.name}${c.args ? ` ${c.args}` : ""}`}
          <Text dimColor>{`  ${c.description}`}</Text>
        </Text>
      ))}
    </Box>
  );
}

function Picker({ rows, index, current }: { rows: SessionRow[]; index: number; current: string }) {
  const start = Math.max(0, Math.min(index - Math.floor(PICKER_ROWS / 2), rows.length - PICKER_ROWS));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold>Sessions  <Text dimColor>↑↓ choose · Enter switch · Esc back</Text></Text>
      {rows.slice(start, start + PICKER_ROWS).map((r, i) => {
        const n = start + i;
        const mark = r.id === current ? "*" : " ";
        return (
          <Text key={r.id} inverse={n === index}>
            {`${mark}${String(n + 1).padStart(3)}  ${r.id}  ${r.state.padEnd(9)} ${String(r.turns).padStart(3)} turns  ${r.preview}`}
          </Text>
        );
      })}
    </Box>
  );
}

function ApprovalBox({ tool, input, color }: { tool: string; input: unknown; color: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>{withoutAnswerMark(formatPrompt({ name: tool, arguments: input }, color))}</Text>
      <Text>
        1 允许一次 <Text dimColor>y</Text>
      </Text>
      <Text>
        2 本会话允许 <Text dimColor>a</Text>
      </Text>
      <Text>
        3 拒绝 <Text dimColor>n · Esc</Text>
      </Text>
    </Box>
  );
}

function QuestionPrompt({ questions, progress }: { questions: Question[]; progress: { answers: string[][]; picked: number[] } }) {
  const index = progress.answers.length;
  const q = questions[index];
  if (!q) return null;
  const count = questions.length > 1 ? ` (${index + 1}/${questions.length})` : "";
  const hint = q.multiple
    ? `1–${q.options.length} toggle · Enter confirm · or type your own answer · Esc skip`
    : `1–${q.options.length} pick · or type your own answer and press Enter · Esc skip`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold>{`? ${q.question}${count}`}</Text>
      {q.options.map((o, i) => (
        <Text key={i}>
          {q.multiple ? (progress.picked.includes(i) ? "[x] " : "[ ] ") : ""}
          <Text color="cyan">{`${i + 1}.`}</Text> {o}
        </Text>
      ))}
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

export type PendingImage = { id: string; name: string };

export type AppProps = {
  host: ChatHost;
  transcript: Transcript;
  maxSteps: number;
  color: boolean;
  /** Working directory for `@` file completion. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Injected so tests never spawn `$EDITOR`. */
  openEditor?: (text: string) => Promise<{ text: string } | { error: "editor unavailable" | "editor failed" }>;
  images?: {
    readClipboard(): Promise<{ bytes?: Buffer; error?: string }>;
    save(bytes: Buffer, name: string): { id: string; name: string } | { error: string };
    copyFile(path: string): { id: string; name: string } | { error: string };
    isImageFile(path: string): boolean;
  };
  /** Modules mounted around the composer; only the `above-input` slot is rendered. */
  modules?: (TuiModule & { id: string })[];
};

export function App({ host, transcript, maxSteps, color, cwd, openEditor = editInEditor, images, modules }: AppProps) {
  const snap = useSyncExternalStore(transcript.subscribe, () => transcript.snapshot);
  const { exit, suspendTerminal } = useApp();
  const { columns, rows } = useWindowSize();
  const root = cwd || process.cwd();
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const editorRef = useRef(editor);
  const [menuIndex, setMenuIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState(0);
  const [picker, setPicker] = useState<{ rows: SessionRow[]; index: number } | undefined>();
  const [exiting, setExiting] = useState(false);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const pendingRef = useRef(pending);
  const [imageError, setImageError] = useState<string | undefined>();
  const [editorError, setEditorError] = useState<string | undefined>();
  const [done, setDone] = useState<string>();
  const [mode, setMode] = useState<AppMode>("normal");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showTodos, setShowTodos] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [scroll, setScroll] = useState(0);
  const [focusedId, setFocusedId] = useState<string | undefined>();
  const [shownPanels, setShownPanels] = useState<Record<string, boolean>>({});
  const [permission, setPermission] = useState<PermissionMode>(
    "permissionMode" in host && host.permissionMode ? host.permissionMode : "manual",
  );
  const panels = (modules ?? []).filter((m) => m.slot === "above-input");
  const interactive = panels.filter((m) => m.interactive);
  const promptHistory = useRef(createPromptHistory());
  const sessionSeen = useRef(snap.sessionId);
  const stashRef = useRef<Stash<PendingImage> | undefined>(undefined);
  const yankRef = useRef("");
  const editingRef = useRef(false);
  const busyRef = useRef(false);
  const started = useRef(0);
  const inputRef = useRef(null);
  const inputBox = useBoxMetrics(inputRef);
  const { setCursorPosition } = useCursor();

  const update = (next: (e: Editor) => Editor) => {
    editorRef.current = next(editorRef.current);
    setEditor(editorRef.current);
  };
  const setPendingImages = (next: PendingImage[]) => {
    pendingRef.current = next;
    setPending(next);
  };
  const fail = (err: unknown) => transcript.note(`[tah] ${err instanceof Error ? err.message : String(err)}`, "error");
  const quit = () => setExiting(true);

  useEffect(() => {
    if (exiting) exit();
  }, [exiting, exit]);

  useEffect(() => {
    if (snap.busy && !busyRef.current) started.current = Date.now();
    if (!snap.busy && busyRef.current && started.current) {
      const sec = Math.max(1, Math.round((Date.now() - started.current) / 1000));
      setDone(`✻ 完成，用了 ${sec}s`);
    }
    busyRef.current = snap.busy;
  }, [snap.busy]);

  useEffect(() => {
    if (sessionSeen.current === snap.sessionId) return;
    sessionSeen.current = snap.sessionId;
    promptHistory.current.clear();
    setHistoryQuery("");
    setMode((current) => (current === "history" ? "normal" : current));
  }, [snap.sessionId]);

  // @ stays open during a turn so Enter inserts a path; the next Enter queues.
  // Slash completion stays closed while busy — a slash command is not queued.
  const mention = mode === "normal" ? fileMentionQuery(editor.lines[editor.row] ?? "", editor.col) : undefined;
  const query = mention === undefined ? slashQuery(editor) : undefined;
  const matches =
    query && !snap.busy
      ? matchCommands(query, [
          ...(host.skills ?? [])
            .filter((s) => s.userInvocable)
            .map((s) => ({ name: s.name, description: s.description })),
          ...(host.slashPrompts ?? []),
        ])
      : [];
  const files = mention !== undefined ? matchFiles(root, mention) : [];
  const historyMatches = mode === "history" ? promptHistory.current.search(historyQuery) : [];
  const historyPick = historyMatches.length === 0 ? 0 : Math.min(historyIndex, historyMatches.length - 1);
  useEffect(() => setMenuIndex(0), [query]);
  useEffect(() => setFileIndex(0), [mention]);

  const runCommand = (cmd: ParsedCommand) => {
    switch (cmd.kind) {
      case "exit":
        return quit();
      case "reset":
        return void host.reset().catch(fail);
      case "compact":
        transcript.continueTurn();
        return void host.compact().catch(fail);
      case "pick":
        return void host
          .listSessions()
          .then((list) => {
            if (list.length === 0) return transcript.note("[tah] no saved sessions");
            setPicker({ rows: list, index: Math.max(0, list.findIndex((r) => r.id === host.sessionId)) });
          })
          .catch(fail);
      case "resume":
        return void host.resume(cmd.ref).catch(fail);
      case "fork":
        return void host.fork(cmd.turns).catch(fail);
      case "error":
        return transcript.note(`[tah] ${cmd.message}`, "error");
    }
  };

  const submit = () => {
    const current = editorRef.current;
    const sending = pendingRef.current;
    const ids = sending.map((i) => i.id);
    if (isBlank(current) && ids.length === 0) return;
    const text = editorText(current);
    const cmd = parseCommand(text);
    if (cmd && transcript.snapshot.busy) return;
    update(() => emptyEditor());
    setDone(undefined);
    setScroll(0);
    if (cmd) return runCommand(cmd);
    setPendingImages([]);
    setImageError(undefined);
    setEditorError(undefined);
    void Promise.resolve(ids.length ? host.send(text.trim(), ids) : host.send(text)).then(
      () => promptHistory.current.push(text),
      (err) => {
        if (sending.length) setPendingImages([...sending, ...pendingRef.current]);
        fail(err);
      },
    );
  };

  /** Keys and pastes only reach the editor when no card or prompt owns the keyboard. */
  const accepting = (s: Snapshot) => !s.approval && !picker && !s.question && !(s.stepLimit && !s.busy) && !exiting;

  const addImages = (added: PendingImage[], error?: string) => {
    if (added.length) {
      setPendingImages([...pendingRef.current, ...added]);
      setImageError(error);
    } else if (error) setImageError(error);
  };

  const pasteImages = (text: string): boolean => {
    if (!images) return false;
    const paths = pastedImagePaths(text, images.isImageFile);
    if (!paths) return false;
    if (!accepting(transcript.snapshot)) return true;
    const added: PendingImage[] = [];
    let error: string | undefined;
    for (const p of paths) {
      const result = images.copyFile(p);
      if ("error" in result) {
        error = result.error;
        break;
      }
      added.push(result);
    }
    addImages(added, error);
    return true;
  };

  const pasteClipboard = () => {
    if (!images) return;
    void ingestClipboard(images)
      .then(({ image, error }) => addImages(image ? [image] : [], error))
      .catch((err) => setImageError(err instanceof Error ? err.message : String(err)));
  };

  const answer = (id: string, a: "yes" | "always" | "no") => host.answer(id, a);

  /** Progress through the pending `ask_user` card; a new card id starts over. */
  type Progress = { id: string; answers: string[][]; picked: number[] };
  const [, setAsked] = useState<Progress>();
  const askedRef = useRef<Progress | undefined>(undefined);
  const progressOf = (id: string): Progress =>
    askedRef.current?.id === id ? askedRef.current : { id, answers: [], picked: [] };
  const setProgress = (p: Progress) => {
    askedRef.current = p;
    setAsked(p);
  };
  const nextQuestion = (id: string, total: number, answer: string[]) => {
    const answers = [...progressOf(id).answers, answer];
    setProgress({ id, answers, picked: [] });
    if (answers.length >= total) host.answerQuestion(id, answers);
  };
  const progress = progressOf(snap.question?.id ?? "");

  usePaste((text) => {
    if (editingRef.current) return;
    if (mode === "history") {
      setHistoryQuery((q) => q + text.replace(/[\r\n]/g, ""));
      setHistoryIndex(0);
      return;
    }
    if (pasteImages(text)) return;
    update((e) => insert(e, text));
  }, { isActive: !snap.approval && !picker && !exiting && focusedId === undefined });

  useInput((input, key) => {
    const s = transcript.snapshot;
    if (editingRef.current) return;
    if (key.ctrl && input === "c") {
      if (s.approval) {
        answer(s.approval.id, "no");
        return host.cancel();
      }
      if (s.busy) return host.cancel();
      if (picker) return setPicker(undefined);
      if (s.stepLimit) return transcript.dismissStepLimit();
      if (editorText(editorRef.current)) return update(() => emptyEditor());
      return quit();
    }

    if (key.ctrl && input === "l") {
      if (suspendTerminal) void suspendTerminal(async () => {});
      return;
    }
    if (key.ctrl && input === "o") {
      setMode(toggleTranscript);
      return;
    }
    if (key.ctrl && input === "t") {
      if (mode === "normal") setShowTodos((open) => !open);
      return;
    }
    if (key.pageUp) {
      setScroll((n) => n + 8);
      return;
    }
    if (key.pageDown) {
      setScroll((n) => Math.max(0, n - 8));
      return;
    }
    if (key.shift && key.tab && host.approve) {
      setPermission((current) => {
        const next = cycleMode(current);
        if ("setPermissionMode" in host) host.setPermissionMode(next);
        return next;
      });
      return;
    }

    if (s.approval) {
      const a = input.toLowerCase();
      if (a === "y" || a === "1") answer(s.approval.id, "yes");
      else if (a === "a" || a === "2") answer(s.approval.id, "always");
      else if (a === "n" || a === "3" || key.return || key.escape) answer(s.approval.id, "no");
      return;
    }

    const p = s.question && progressOf(s.question.id);
    const current = p && s.question?.questions[p.answers.length];
    if (s.question && p && current) {
      const { id, questions } = s.question;
      if (key.escape) {
        update(() => emptyEditor());
        return host.skipQuestion(id);
      }
      const typed = editorText(editorRef.current).trim();
      const n = Number(input);
      if (!typed && /^[1-9]$/.test(input) && n <= current.options.length) {
        if (!current.multiple) return nextQuestion(id, questions.length, [current.options[n - 1]!]);
        const picked = p.picked.includes(n - 1) ? p.picked.filter((i) => i !== n - 1) : [...p.picked, n - 1];
        return setProgress({ ...p, picked });
      }
      if (key.return && !key.meta && !key.shift) {
        const chosen = [...p.picked].sort((a, b) => a - b).map((i) => current.options[i]!);
        const answer = typed ? [...chosen, typed] : chosen;
        if (answer.length === 0) return;
        update(() => emptyEditor());
        return nextQuestion(id, questions.length, answer);
      }
    }

    if (picker) {
      const n = picker.rows.length;
      if (key.upArrow) setPicker({ ...picker, index: (picker.index - 1 + n) % n });
      else if (key.downArrow) setPicker({ ...picker, index: (picker.index + 1) % n });
      else if (key.escape) setPicker(undefined);
      else if (key.return) {
        const row = picker.rows[picker.index];
        setPicker(undefined);
        if (row && row.id !== host.sessionId) void host.resume(row.id).catch(fail);
      }
      return;
    }

    if (s.stepLimit && !s.busy) {
      if (key.return) {
        transcript.continueTurn();
        host.continueTurn().catch(fail);
      } else if (input.toLowerCase() === "n" || key.escape) {
        transcript.dismissStepLimit();
      }
      return;
    }

    // A focused panel owns every other key (its own useTuiInput reads them); Esc hands the keyboard back.
    if (accepting(s) && interactive.length > 0) {
      if (key.ctrl && input === "p") {
        const at = interactive.findIndex((m) => m.id === focusedId);
        return setFocusedId(interactive[at + 1]?.id);
      }
      if (focusedId !== undefined) {
        if (key.escape) setFocusedId(undefined);
        return;
      }
    }

    if (mode === "history") {
      const action = historyKeyAction(input, key, historyQuery, historyPick, historyMatches);
      if (action.type === "cancel") {
        setHistoryQuery("");
        setMode("normal");
      } else if (action.type === "move") {
        setHistoryIndex(action.index);
      } else if (action.type === "accept") {
        update(() => insert(emptyEditor(), action.text));
        setHistoryQuery("");
        setMode("normal");
      } else if (action.type === "query") {
        setHistoryQuery(action.query);
        setHistoryIndex(0);
      }
      return;
    }

    // Transcript Esc/q leaves the mode without clearing the draft. Cards already consumed Esc above.
    if (mode === "transcript" && accepting(s) && (key.escape || (input === "q" && !key.ctrl && !key.meta))) {
      setMode("normal");
      return;
    }

    if (key.ctrl && input === "r") {
      if (mode === "normal" && accepting(s)) {
        setHistoryQuery("");
        setHistoryIndex(0);
        setMode("history");
      }
      return;
    }

    if (key.ctrl && input === "g") {
      if (mode === "normal" && accepting(s)) {
        editingRef.current = true;
        const initial = editorText(editorRef.current);
        const edit = async () => {
          try {
            const result = await openEditor(initial);
            if ("error" in result) setEditorError(result.error);
            else {
              setEditorError(undefined);
              update(() => insert(emptyEditor(), result.text));
            }
          } catch {
            setEditorError("editor failed");
          }
        };
        void (async () => {
          try {
            if (suspendTerminal) await suspendTerminal(edit);
            else await edit();
          } finally {
            editingRef.current = false;
          }
        })();
      }
      return;
    }

    if (key.ctrl && input === "s") {
      if (mode === "normal" && accepting(s)) {
        const next = cycleStash(stashRef.current, editorRef.current, pendingRef.current);
        stashRef.current = next.stash;
        update(() => next.editor);
        setPendingImages(next.pendingImages);
      }
      return;
    }

    if (key.meta && input === "v" && !s.question) return pasteClipboard();

    if (key.ctrl && input === "d") {
      if (!s.busy && isBlank(editorRef.current)) quit();
      return;
    }

    if (files.length > 0) {
      const selected = files[Math.min(fileIndex, files.length - 1)]!;
      if (key.upArrow) return setFileIndex((i) => (i - 1 + files.length) % files.length);
      if (key.downArrow) return setFileIndex((i) => (i + 1) % files.length);
      if (key.tab || (key.return && !key.meta && !key.shift)) return update((e) => insertFileMention(e, selected));
    }

    if (matches.length > 0) {
      const selected = matches[Math.min(menuIndex, matches.length - 1)]!;
      if (key.upArrow) return setMenuIndex((i) => (i - 1 + matches.length) % matches.length);
      if (key.downArrow) return setMenuIndex((i) => (i + 1) % matches.length);
      // Tab always inserts. Enter inserts unless the line already equals the pick (then fall through to submit).
      if (key.tab) return update(() => insert(emptyEditor(), `${selected.name}${selected.args ? " " : ""}`));
      if (key.return && !key.meta && !key.shift) {
        const typed = editorText(editorRef.current).trim();
        if (typed !== selected.name) {
          return update(() => insert(emptyEditor(), `${selected.name}${selected.args ? " " : ""}`));
        }
      }
    }

    if (key.return) {
      if (key.meta || key.shift) return update((e) => insert(e, "\n"));
      const e = editorRef.current;
      const line = e.lines[e.row] ?? "";
      if (line.endsWith("\\") && e.col === Array.from(line).length) {
        return update((cur) => insert(backspace(cur), "\n"));
      }
      return submit();
    }
    if (key.leftArrow) return update((e) => move(e, "left"));
    if (key.rightArrow) return update((e) => move(e, "right"));
    const last = s.queue.at(-1);
    if (key.upArrow && last && isBlank(editorRef.current)) {
      host.removeQueued(last.id);
      if (last.attachments?.length) setPendingImages([...pendingRef.current, ...last.attachments.map(({ id, name }) => ({ id, name }))]);
      return update(() => insert(emptyEditor(), last.text));
    }
    if (key.upArrow) return update((e) => move(e, "up"));
    if (key.downArrow) return update((e) => move(e, "down"));
    if (key.home || (key.ctrl && input === "a")) return update((e) => move(e, "home"));
    if (key.end || (key.ctrl && input === "e")) return update((e) => move(e, "end"));
    if (key.backspace && pendingRef.current.length && editorText(editorRef.current) === "") {
      return setPendingImages(pendingRef.current.slice(0, -1));
    }
    if (key.backspace) return update(backspace);
    if (key.delete) return update(deleteForward);
    if (mode === "normal" && key.ctrl && input === "k") {
      update((e) => {
        const next = applyKill(e, "end", yankRef.current);
        yankRef.current = next.yank;
        return next.editor;
      });
      return;
    }
    if (mode === "normal" && key.ctrl && input === "u") {
      update((e) => {
        const next = applyKill(e, "start", yankRef.current);
        yankRef.current = next.yank;
        return next.editor;
      });
      return;
    }
    if (mode === "normal" && key.ctrl && input === "w") {
      update((e) => {
        const next = applyKill(e, "word", yankRef.current);
        yankRef.current = next.yank;
        return next.editor;
      });
      return;
    }
    if (mode === "normal" && key.ctrl && input === "y") {
      if (yankRef.current) update((e) => yank(e, yankRef.current));
      return;
    }
    if (mode === "normal" && key.meta && (input === "b" || input === "B")) return update((e) => moveWord(e, "left"));
    if (mode === "normal" && key.meta && (input === "f" || input === "F")) return update((e) => moveWord(e, "right"));
    if (key.escape) {
      if (!isBlank(editorRef.current) || pendingRef.current.length) {
        setPendingImages([]);
        return update(() => emptyEditor());
      }
      if (s.busy) return host.cancel();
      return;
    }
    if (key.tab || key.ctrl || key.meta) return;
    if (input === "?" && mode === "normal" && editorText(editorRef.current) === "" && pendingRef.current.length === 0) {
      setShowHelp((open) => !open);
      return;
    }
    if (input) update((e) => insert(e, input));
  }, { isActive: !exiting });

  const typing = !snap.approval && !picker && !(snap.stepLimit && !snap.busy) && !exiting && mode !== "history";
  const layout = layoutEditor(editor, Math.max(1, columns - INPUT_INSET - 2));

  setCursorPosition(
    typing && inputBox.hasMeasured
      ? { x: inputBox.left + INPUT_INSET + layout.cursor.x, y: inputBox.top + 1 + layout.cursor.y }
      : undefined,
  );

  const todos = latestTodos(snap.items);
  const expanded = mode === "transcript";
  const hint = footerHint({
    mode,
    busy: snap.busy,
    queuedRecall: snap.queue.length > 0 && isBlank(editor) && mode === "normal",
  });
  const tokens =
    snap.tokens && snap.tokens.promptTokens + snap.tokens.completionTokens > 0
      ? `in ${snap.tokens.promptTokens.toLocaleString("en-US")} · out ${snap.tokens.completionTokens.toLocaleString("en-US")}`
      : undefined;
  const status = [
    snap.model ?? "tah",
    host.approve ? MODE_LABEL[permission] : "approve=off",
    snap.sessionId,
    `${snap.rounds} rounds`,
    tokens,
  ].filter((part): part is string => Boolean(part));
  const chrome =
    6 +
    (snap.approval ? 12 : 0) +
    (snap.question ? 8 : 0) +
    (picker ? 12 : 0) +
    (mode === "history" ? 1 + Math.min(historyMatches.length, MENU_ROWS) : 0) +
    (showHelp && mode === "normal" ? 2 : 0) +
    (showTodos && todos ? todos.length + 1 : 0) +
    (files.length > 0 ? Math.min(files.length, MENU_ROWS) : 0) +
    panels.filter((m) => m.title || shownPanels[m.id]).length * PANEL_ROWS;
  const room = Math.max(4, rows - chrome);
  const visible = windowItems(snap.items, Math.max(1, room - liveLines(snap)), scroll, expanded);

  return (
    <Box flexDirection="column" height={rows}>
      {exiting ? null : (
        <>
          <Box flexDirection="column" flexGrow={1} justifyContent="flex-end" overflow="hidden">
            {visible.map((item) => (
              <HistoryItem key={item.id} item={item} open={expanded} color={color} />
            ))}
            <Live snap={snap} maxLines={Math.max(3, room)} />
          </Box>
          {snap.approval ? <ApprovalBox tool={snap.approval.tool} input={snap.approval.input} color={color} /> : null}
          {snap.question ? <QuestionPrompt questions={snap.question.questions} progress={progress} /> : null}
          {snap.stepLimit && !snap.busy ? <Text>{withoutAnswerMark(formatContinuePrompt(maxSteps, color))}</Text> : null}
          {picker ? <Picker rows={picker.rows} index={picker.index} current={snap.sessionId} /> : null}
          {mode === "history" ? <HistorySearch query={historyQuery} matches={historyMatches} index={historyPick} /> : null}
          {showHelp && mode === "normal" ? <HelpBlock /> : null}
          {showTodos && todos ? <TodosBar todos={todos} /> : null}
          {mode === "normal" && files.length > 0 && typing ? (
            <FileMenu files={files} index={Math.min(fileIndex, files.length - 1)} />
          ) : null}
          {mode !== "history" && matches.length > 0 && typing ? (
            <Menu matches={matches} index={Math.min(menuIndex, matches.length - 1)} />
          ) : null}
          {snap.queue.map((q) => (
            <Text key={q.id} dimColor={!q.held} {...(q.held ? { color: "yellow" } : {})} wrap="truncate">
              {q.held ? "  paused  " : "  queued  "}
              {[q.text, ...(q.attachments ?? []).map((a) => a.name)].filter(Boolean).join(" ")}
            </Text>
          ))}
          {panels.map((m) => {
            // Cards and the session picker own the keyboard, so a module loses focus while they are open.
            const focused = focusedId === m.id && accepting(snap);
            const ctx: TuiCtx = {
              cwd: root,
              sessionId: host.sessionId,
              busy: snap.busy,
              focused,
              ...(snap.model ? { model: snap.model } : {}),
              ...(snap.tokens ? { sessionUsage: snap.tokens } : {}),
              todos: (todos ?? []).map(({ content, status }) => ({ content, status })),
              send: panelSend(m.id, focused, (text) => host.send(text)),
            };
            return (
              <TuiPanel
                key={m.id}
                module={m}
                ctx={ctx}
                onShown={(shown) => setShownPanels((prev) => (prev[m.id] === shown ? prev : { ...prev, [m.id]: shown }))}
              />
            );
          })}
          {imageError ? <Text dimColor wrap="truncate">{imageError}</Text> : null}
          {editorError ? <Text dimColor wrap="truncate">{editorError}</Text> : null}
          {pending.length ? <Text dimColor wrap="truncate">{pending.map((i) => i.name).join(" ")}</Text> : null}
          {done && !snap.busy ? <Text dimColor>{done}</Text> : null}
          <Box ref={inputRef} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
            {layout.rows.map((row, i) => (
              <Text key={i} wrap="truncate">
                <Text dimColor>{i === 0 ? "> " : "  "}</Text>
                {row}
              </Text>
            ))}
          </Box>
          <Box justifyContent="space-between" gap={1} paddingX={1}>
            <Text dimColor wrap="truncate">{hint}</Text>
            <Text dimColor wrap="truncate">{status.join(" · ")}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
