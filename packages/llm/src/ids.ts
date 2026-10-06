let n = 0;

export function nextId(prefix: string): string {
  n += 1;
  return `${prefix}_${n}_${Date.now().toString(36)}`;
}
