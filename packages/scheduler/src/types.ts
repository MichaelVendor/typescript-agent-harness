export type ScheduledJob = () => void | Promise<void>;

export type SchedulerService = {
  once(name: string, delayMs: number, job: ScheduledJob): void;
  every(name: string, intervalMs: number, job: ScheduledJob): void;
  cancel(name: string): void;
};
