export type ProjectRuntime = {
  ensure(projectId: string): Promise<{ baseUrl: string }>;
  stop(projectId: string): Promise<void>;
  touch(projectId: string): void;
};

export function createFakeRuntime(): ProjectRuntime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async ensure(projectId) {
      calls.push(`ensure:${projectId}`);
      return { baseUrl: `http://fake/${projectId}` };
    },
    async stop(projectId) {
      calls.push(`stop:${projectId}`);
    },
    touch(projectId) {
      calls.push(`touch:${projectId}`);
    },
  };
}

export function sweepIdle(
  runtime: Pick<ProjectRuntime, "stop">,
  lastTouch: Map<string, number>,
  now: number,
  idleMs: number,
): void {
  for (const [projectId, touchedAt] of lastTouch) {
    if (now - touchedAt >= idleMs) {
      lastTouch.delete(projectId);
      void runtime.stop(projectId);
    }
  }
}
