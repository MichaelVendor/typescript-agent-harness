import { useInput, type Key } from "ink";
import type { ReactNode } from "react";

export const TUI_SLOTS = ["above-input", "footer", "transcript"] as const;
export type TuiSlot = (typeof TUI_SLOTS)[number];
export const MOUNTED_SLOTS: readonly TuiSlot[] = ["above-input"];

export type TuiUsage = { promptTokens: number; completionTokens: number; totalTokens: number };
export type TuiTodo = { content: string; status: string };

export type TuiCtx = {
  cwd: string;
  sessionId: string;
  busy: boolean;
  focused: boolean;
  model?: string;
  usage?: TuiUsage;
  sessionUsage?: TuiUsage;
  todos: TuiTodo[];
  send(text: string): Promise<void>;
};

export type TuiModule = {
  id?: string;
  slot: TuiSlot;
  title?: string;
  interactive?: boolean;
  Component(props: { ctx: TuiCtx }): ReactNode;
};

export function defineTuiModule(module: TuiModule): TuiModule {
  return module;
}

export function panelSend(
  id: string,
  focused: boolean,
  send: (text: string) => Promise<void>,
): (text: string) => Promise<void> {
  return (text) => {
    if (!focused) return Promise.reject(new Error(`tui: ${id} is not focused`));
    return send(text);
  };
}

export function useTuiInput(ctx: TuiCtx, handler: (input: string, key: Key) => void): void {
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === "p")) return;
      handler(input, key);
    },
    { isActive: ctx.focused },
  );
}
