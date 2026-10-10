import { Box, Static, Text, useApp, useBoxMetrics, useCursor, useInput, usePaste, useWindowSize } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatContinuePrompt, formatPrompt } from "../approve.js";
import type { ChatHost } from "../host.js";
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
  slashQuery,
  type Editor,
} from "./editor.js";
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

function ToolLine(props: { tool: string; summary: string; status: "running" | "ok" | "failed"; result?: string }) {
  return (
    <Text>
      <Text color={props.status === "failed" ? "red" : "cyan"}>⏺ </Text>
      <Text bold>{props.tool}</Text>
      {props.summary ? <Text dimColor>{`  ${props.summary}`}</Text> : null}
      {"  "}
      {props.status === "running" ? <Spinner /> : null}
      {props.status === "ok" ? <Text color="green">{`✓ ${props.result ?? ""}`}</Text> : null}
      {props.status === "failed" ? <Text color="red">{`✗ ${props.result ?? ""}`}</Text> : null}
    </Text>
  );
}

function StaticItem({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="cyan">{"› "}</Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return <Text>{item.text || " "}</Text>;
    case "tool":
      return <ToolLine tool={item.tool} summary={item.summary} status={item.ok ? "ok" : "failed"} result={item.result} />;
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
      {snap.busy && !snap.live && snap.tools.length === 0 && !snap.approval ? (
        <Text>
          <Spinner /> <Text dimColor>thinking…</Text>
        </Text>
      ) : null}
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

export type AppProps = { host: ChatHost; transcript: Transcript; maxSteps: number; color: boolean };

export function App({ host, transcript, maxSteps, color }: AppProps) {
  const snap = useSyncExternalStore(transcript.subscribe, () => transcript.snapshot);
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const editorRef = useRef(editor);
  const [menuIndex, setMenuIndex] = useState(0);
  const [picker, setPicker] = useState<{ rows: SessionRow[]; index: number } | undefined>();
  const [exiting, setExiting] = useState(false);
  const inputRef = useRef(null);
  const inputBox = useBoxMetrics(inputRef);
  const { setCursorPosition } = useCursor();

  const update = (next: (e: Editor) => Editor) => {
    editorRef.current = next(editorRef.current);
    setEditor(editorRef.current);
  };
  const fail = (err: unknown) => transcript.note(`[tah] ${err instanceof Error ? err.message : String(err)}`, "error");
  const quit = () => setExiting(true);

  useEffect(() => {
    if (exiting) exit();
  }, [exiting, exit]);

  const query = slashQuery(editor);
  const matches = query && !snap.busy ? matchCommands(query) : [];
  useEffect(() => setMenuIndex(0), [query]);

  const runCommand = (cmd: ParsedCommand) => {
    switch (cmd.kind) {
      case "exit":
        return quit();
      case "reset":
        return void host.reset().catch(fail);
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
    if (isBlank(current) || transcript.snapshot.busy) return;
    const text = editorText(current);
    update(() => emptyEditor());
    const cmd = parseCommand(text);
    if (cmd) return runCommand(cmd);
    transcript.user(text);
    host.send(text).catch(fail);
  };

  const answer = (id: string, a: "yes" | "always" | "no") => {
    host.answer(id, a);
    transcript.clearApproval();
  };

  usePaste((text) => update((e) => insert(e, text)), { isActive: !snap.approval && !picker && !exiting });

  useInput((input, key) => {
    const s = transcript.snapshot;
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

    if (s.approval) {
      const a = input.toLowerCase();
      if (a === "y") answer(s.approval.id, "yes");
      else if (a === "a") answer(s.approval.id, "always");
      else if (a === "n" || key.return || key.escape) answer(s.approval.id, "no");
      return;
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

    if (key.ctrl && input === "d") {
      if (!s.busy && isBlank(editorRef.current)) quit();
      return;
    }

    if (matches.length > 0) {
      const selected = matches[Math.min(menuIndex, matches.length - 1)]!;
      if (key.upArrow) return setMenuIndex((i) => (i - 1 + matches.length) % matches.length);
      if (key.downArrow) return setMenuIndex((i) => (i + 1) % matches.length);
      if (key.tab) return update(() => insert(emptyEditor(), `${selected.name}${selected.args ? " " : ""}`));
      if (key.return && !key.meta && !key.shift) {
        update(() => emptyEditor());
        return runCommand(parseCommand(selected.name)!);
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
    if (key.upArrow) return update((e) => move(e, "up"));
    if (key.downArrow) return update((e) => move(e, "down"));
    if (key.home || (key.ctrl && input === "a")) return update((e) => move(e, "home"));
    if (key.end || (key.ctrl && input === "e")) return update((e) => move(e, "end"));
    if (key.backspace) return update(backspace);
    if (key.delete) return update(deleteForward);
    if (key.escape || key.tab || key.ctrl || key.meta) return;
    if (input) update((e) => insert(e, input));
  }, { isActive: !exiting });

  const typing = !snap.approval && !picker && !(snap.stepLimit && !snap.busy) && !exiting;
  const layout = layoutEditor(editor, Math.max(1, columns - INPUT_INSET - 2));

  setCursorPosition(
    typing && inputBox.hasMeasured
      ? { x: inputBox.left + INPUT_INSET + layout.cursor.x, y: inputBox.top + 1 + layout.cursor.y }
      : undefined,
  );

  const hint = snap.busy ? "Ctrl+C stop" : "Enter send · Alt+Enter newline · / commands";
  const status = [snap.model ?? "tah", snap.sessionId, `${snap.rounds} rounds`, ...(host.approve ? [] : ["approve=off"])];

  return (
    <Box flexDirection="column">
      <Static items={snap.items}>{(item) => <StaticItem key={item.id} item={item} />}</Static>
      {exiting ? null : (
        <>
          <Live snap={snap} maxLines={Math.max(3, rows - 12)} />
          {snap.approval ? (
            <Text>
              {withoutAnswerMark(formatPrompt({ name: snap.approval.tool, arguments: snap.approval.input }, color))}
            </Text>
          ) : null}
          {snap.stepLimit && !snap.busy ? <Text>{withoutAnswerMark(formatContinuePrompt(maxSteps, color))}</Text> : null}
          {picker ? <Picker rows={picker.rows} index={picker.index} current={snap.sessionId} /> : null}
          {matches.length > 0 && typing ? <Menu matches={matches} index={Math.min(menuIndex, matches.length - 1)} /> : null}
          <Box ref={inputRef} borderStyle="round" borderColor={typing ? "cyan" : "gray"} paddingX={1} flexDirection="column">
            {layout.rows.map((row, i) => (
              <Text key={i} wrap="truncate">
                <Text color="cyan">{i === 0 ? "> " : "  "}</Text>
                {row}
              </Text>
            ))}
          </Box>
          <Box justifyContent="space-between" gap={1} paddingX={1}>
            <Text dimColor wrap="truncate">{status.join(" · ")}</Text>
            <Text dimColor wrap="truncate">{hint}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
