import type { BrowserInput, HostEvent } from "@typescript-agent-harness/cli";
import type { Entry } from "./state";

type Mods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };
type KeyInput = Extract<BrowserInput, { type: "key" }>;

/** CDP modifier bits. */
export function modifiers(e: Mods): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const local = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "[::1]";

/** A plain click on an http(s) link opens it in the browser panel; modified clicks and links to tah itself (`origin`) do not. */
export function opensInPanel(href: string | undefined, click: Mods & { button: number }, origin: string): boolean {
  if (!href || click.button !== 0 || click.altKey || click.ctrlKey || click.metaKey || click.shiftKey) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const self = new URL(origin);
  return !(local(url.hostname) && local(self.hostname) && url.port === self.port);
}

/** What the address bar sends: `localhost:3000` → `http://localhost:3000`, `example.com` → `https://example.com`; full URLs, `about:` and `/…` as typed. */
export function addressURL(text: string): string {
  const t = text.trim();
  if (!t || /^[a-z][a-z\d+.-]*:\/\//i.test(t) || /^about:/i.test(t) || t.startsWith("/")) return t;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(t) ? `http://${t}` : `https://${t}`;
}

/** A point on the drawn frame (`rect`) in page CSS pixels. */
export function toPage(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number } {
  return { x: ((clientX - rect.left) / rect.width) * frame.width, y: ((clientY - rect.top) / rect.height) * frame.height };
}

/** Back / forward (3, 4) are not sent. */
export function mouseButton(button: number): "left" | "middle" | "right" | undefined {
  return (["left", "middle", "right"] as const)[button];
}

const CLIPBOARD = new Set(["c", "v", "x"]);

/** The letter a shortcut means: the typed letter, or on non-Latin layouts the physical key. */
const shortcutLetter = (e: { key: string; code: string }) =>
  /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : "";

/** Key presses sent as keys: special keys and shortcuts. Typed characters arrive as `text` from the input box instead; IME composition and copy / paste / cut are left to the box. */
export function keyInput(e: Mods & { key: string; code: string; keyCode: number; isComposing: boolean }, event: "down" | "up"): BrowserInput | null {
  // Safari ends IME composition with an Enter keydown that has isComposing false but keyCode 229.
  if (e.isComposing || e.keyCode === 229 || e.key === "Process" || e.key === "Dead") return null;
  const shortcut = e.metaKey || e.ctrlKey;
  if (e.key.length === 1 && !shortcut) return null;
  if (shortcut && CLIPBOARD.has(shortcutLetter(e))) return null;
  const input: KeyInput = { type: "key", event, key: e.key, code: e.code, keyCode: e.keyCode, modifiers: modifiers(e) };
  return e.key === "Enter" && event === "down" ? { ...input, text: "\r" } : input;
}

/** A browser tool is running. */
export function agentBrowsing(entries: Entry[]): boolean {
  return entries.some((e) => e.kind === "tool" && e.status === "running" && e.tool.startsWith("browser_"));
}

/** The agent starts using the browser: show the panel. */
export function opensBrowser(event: HostEvent): boolean {
  return event.type === "tool.start" && event.tool === "browser_open";
}
