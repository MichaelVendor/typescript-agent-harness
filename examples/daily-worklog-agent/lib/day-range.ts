/** Offset (ms) of `timezone` from UTC at instant `ts`. */
function tzOffsetMs(ts: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Local midnight of `date` (YYYY-MM-DD) in `timezone`, as a UTC instant. */
function localMidnight(date: string, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  const guess = naive - tzOffsetMs(naive, timezone);
  return new Date(naive - tzOffsetMs(guess, timezone));
}

/** [start, end) of the local calendar day. */
export function dayRange(date: string, timezone: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: localMidnight(date, timezone), end: localMidnight(next, timezone) };
}
