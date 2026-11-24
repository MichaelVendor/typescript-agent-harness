const key = (origin: string) => `tah.unread.${origin}`;

function read(origin: string): Record<string, true> {
  try {
    const raw = localStorage.getItem(key(origin));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, true> = {};
    for (const [id, val] of Object.entries(parsed)) {
      if (val === true) out[id] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function write(origin: string, data: Record<string, true>): void {
  localStorage.setItem(key(origin), JSON.stringify(data));
}

export function loadUnread(origin: string): Record<string, true> {
  return read(origin);
}

export function markUnread(origin: string, id: string): void {
  write(origin, { ...read(origin), [id]: true });
}

export function clearUnread(origin: string, id: string): void {
  const cur = read(origin);
  if (!(id in cur)) return;
  const { [id]: _, ...rest } = cur;
  write(origin, rest);
}