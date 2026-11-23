export type SessionStatusDto = {
  cwd: string;
  busy: boolean;
  pending: null | { kind: "approval" | "question"; id: string };
  workers: Array<{ workerId: string; busy: boolean; attention?: string }>;
  superAgent?: { ticketCount: number };
};

export function buildSessionStatus(input: {
  cwd: string;
  busy: boolean;
  pending: SessionStatusDto["pending"];
  workers?: SessionStatusDto["workers"];
  ticketCount?: number;
}): SessionStatusDto {
  const dto: SessionStatusDto = {
    cwd: input.cwd,
    busy: input.busy,
    pending: input.pending,
    workers: input.workers ?? [],
  };
  if (input.ticketCount !== undefined) dto.superAgent = { ticketCount: input.ticketCount };
  return dto;
}
