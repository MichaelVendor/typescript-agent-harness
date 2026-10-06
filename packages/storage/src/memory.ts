import type {
  PersistedCheckpoint,
  PersistedEvent,
  PersistedSession,
  StorageService,
} from "./types.js";

export function createMemoryStorage(): StorageService {
  const sessions = new Map<string, PersistedSession>();
  const events: PersistedEvent[] = [];
  const checkpoints: PersistedCheckpoint[] = [];

  return {
    async saveSession(row) {
      sessions.set(row.id, row);
    },
    async getSession(id) {
      return sessions.get(id);
    },
    async listSessions() {
      return [...sessions.values()];
    },
    async appendEvent(event) {
      events.push(event);
    },
    async listEvents(sessionId) {
      return events.filter((e) => e.sessionId === sessionId);
    },
    async saveCheckpoint(row) {
      checkpoints.push(row);
    },
    async latestCheckpoint(sessionId) {
      return [...checkpoints].reverse().find((c) => c.sessionId === sessionId);
    },
  };
}
