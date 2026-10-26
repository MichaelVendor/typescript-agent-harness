import { Box, Text } from "ink";
import { Component, useEffect, type ReactNode } from "react";
import type { TuiCtx, TuiModule } from "./modules.js";

export const PANEL_ROWS = 8;

class PanelBoundary extends Component<{ id: string; children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(err: unknown): { error: string } {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (this.state.error) return <Text color="red">{`tui: ${this.props.id}: ${this.state.error}`}</Text>;
    return this.props.children;
  }
}

type PanelProps = {
  module: TuiModule & { id: string };
  ctx: TuiCtx;
  /** Reports whether the panel occupies rows, so the app can budget its chrome. */
  onShown?: (shown: boolean) => void;
};

/** The module is called as a function so a `null` result with no title can collapse to nothing. */
function PanelBody({ module, ctx, onShown }: PanelProps) {
  const body = module.Component({ ctx });
  const shown = Boolean(module.title) || (body !== null && body !== undefined && body !== false);
  useEffect(() => {
    onShown?.(shown);
  }, [shown]);
  if (!shown) return null;
  return (
    <Box flexDirection="column" maxHeight={PANEL_ROWS} overflow="hidden" paddingX={1}>
      {module.title ? <Text dimColor>{module.title}</Text> : null}
      {body}
    </Box>
  );
}

export function TuiPanel(props: PanelProps) {
  return (
    <PanelBoundary id={props.module.id}>
      <PanelBody {...props} />
    </PanelBoundary>
  );
}
