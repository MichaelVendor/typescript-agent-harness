import { watch } from "node:fs";
import path from "node:path";
import { useEffect, useState } from "react";
import { Box, Text, defineTuiModule, useTuiInput, type TuiCtx } from "@typescript-agent-harness/cli";
import { moneySign, recommendFromDisk, type RecommendedQuery } from "../lib/recommend.ts";

const SHOW = 4;

function short(title: string): string {
  const text = title.replace(/\s+/g, " ").trim();
  return text.length > 36 ? `${text.slice(0, 35)}…` : text;
}

type Row = {
  asin: string;
  title: string;
  priceEur: number;
  query: string;
  send: string;
  currency: "EUR" | "USD";
  askLabel: string;
  action: string;
};

function rowsOf(items: RecommendedQuery[]): Row[] {
  const queues = items.map((item) => ({
    item,
    products: [...item.products],
  }));
  const rows: Row[] = [];
  while (rows.length < SHOW && queues.some((q) => q.products.length > 0)) {
    for (const q of queues) {
      if (rows.length >= SHOW) break;
      const product = q.products.shift();
      if (!product) continue;
      rows.push({
        ...product,
        query: q.item.query,
        send: q.item.send,
        currency: q.item.currency,
        askLabel: q.item.askLabel,
        action: q.item.action,
      });
    }
  }
  return rows;
}

function Recommend({ ctx }: { ctx: TuiCtx }) {
  const [items, setItems] = useState<RecommendedQuery[]>(() => recommendFromDisk(ctx.cwd));
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const load = () => setItems(recommendFromDisk(ctx.cwd));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watcher: ReturnType<typeof watch> | undefined;
    try {
      watcher = watch(path.join(ctx.cwd, "data"), () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(load, 300);
      });
    } catch {
      watcher = undefined;
    }
    const poll = setInterval(load, 30_000);
    return () => {
      watcher?.close();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [ctx.cwd]);

  const rows = rowsOf(items);
  const at = rows.length === 0 ? 0 : Math.min(index, rows.length - 1);
  useTuiInput(ctx, (input, key) => {
    if (rows.length === 0 || ctx.busy) return;
    if (key.upArrow || input === "k") {
      setIndex((i) => (i - 1 + rows.length) % rows.length);
      return;
    }
    if (key.downArrow || input === "j") {
      setIndex((i) => (i + 1) % rows.length);
      return;
    }
    const picked = /^[1-4]$/.test(input) ? rows[Number(input) - 1] : key.return ? rows[at] : undefined;
    if (picked) void ctx.send(picked.send).then(() => undefined, () => undefined);
  });

  if (rows.length === 0) return null;
  const head = rows[0];
  const title = head ? `${head.askLabel} · ${head.query} · ${head.action}` : "";
  return (
    <Box flexDirection="column">
      <Text dimColor>{ctx.focused ? `${title}  ↑↓ 回车` : `${title}  Ctrl+P 选择`}</Text>
      {rows.map((row, i) => {
        const mark = ctx.focused && i === at;
        return (
          <Text key={`${row.askLabel}-${row.asin}`} wrap="truncate" {...(mark ? { color: "cyan" } : { dimColor: true })}>
            {`${mark ? "›" : " "} ${i + 1}  ${row.askLabel}  ${short(row.title)}  ${moneySign(row.currency)}${row.priceEur.toFixed(2)}`}
          </Text>
        );
      })}
    </Box>
  );
}

export default defineTuiModule({
  id: "recommend",
  slot: "above-input",
  interactive: true,
  Component: Recommend,
});
