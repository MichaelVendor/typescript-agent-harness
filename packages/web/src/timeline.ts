export type TimelineGroupId = "needs_human" | "running" | "queued" | "done" | "failed";

const GROUP_ORDER: TimelineGroupId[] = [
  "needs_human",
  "running",
  "queued",
  "done",
  "failed",
];

const STATUS_SET = new Set<string>(GROUP_ORDER);

type TimelineTicket = { id: string; status: string; createdAt: string; goal: string };

export function groupTicketsForTimeline(
  tickets: TimelineTicket[],
): { id: TimelineGroupId; tickets: TimelineTicket[] }[] {
  const buckets = new Map<TimelineGroupId, TimelineTicket[]>();
  for (const id of GROUP_ORDER) {
    buckets.set(id, []);
  }

  for (const ticket of tickets) {
    if (!STATUS_SET.has(ticket.status)) continue;
    buckets.get(ticket.status as TimelineGroupId)!.push(ticket);
  }

  const byCreatedDesc = (a: TimelineTicket, b: TimelineTicket) =>
    b.createdAt.localeCompare(a.createdAt);

  const out: { id: TimelineGroupId; tickets: TimelineTicket[] }[] = [];
  for (const id of GROUP_ORDER) {
    const group = buckets.get(id)!;
    if (group.length === 0) continue;
    group.sort(byCreatedDesc);
    out.push({ id, tickets: group });
  }
  return out;
}