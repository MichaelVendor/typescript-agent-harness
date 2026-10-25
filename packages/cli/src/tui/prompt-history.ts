export type PromptHistory = {
  push(text: string): void;
  clear(): void;
  /** Newest-first matches; empty query returns recent up to limit. */
  search(query: string, limit?: number): string[];
};

export function createPromptHistory(max = 200): PromptHistory {
  const entries: string[] = [];

  const push = (text: string) => {
    if (text.trim() === "") return;
    if (entries[0] === text) return;
    entries.unshift(text);
    if (entries.length > max) entries.length = max;
  };

  const clear = () => {
    entries.length = 0;
  };

  const search = (query: string, limit = max) => {
    const q = query.toLowerCase();
    const out: string[] = [];
    for (const entry of entries) {
      if (q === "" || entry.toLowerCase().includes(q)) {
        out.push(entry);
        if (out.length >= limit) break;
      }
    }
    return out;
  };

  return { push, clear, search };
};
