import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  PersistedCheckpoint,
  PersistedEvent,
  PersistedSession,
  StorageService,
} from "./types.js";

export function createSqliteStorage(filePath: string): StorageService {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      max_steps INTEGER NOT NULL,
      messages_json TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      step_id TEXT,
      step_type TEXT,
      message_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const upsertSession = db.prepare(`
    INSERT INTO sessions (id, status, max_steps, messages_json, steps_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      max_steps = excluded.max_steps,
      messages_json = excluded.messages_json,
      steps_json = excluded.steps_json,
      updated_at = excluded.updated_at
  `);
  const selectSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
  const selectSessions = db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO events (id, session_id, type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const selectEvents = db.prepare(
    `SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC`,
  );
  const insertCheckpoint = db.prepare(`
    INSERT INTO checkpoints (id, session_id, step_id, step_type, message_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectCheckpoint = db.prepare(`
    SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
  `);

  function asSession(row: Record<string, unknown>): PersistedSession {
    return {
      id: String(row.id),
      status: String(row.status),
      maxSteps: Number(row.max_steps),
      messagesJson: String(row.messages_json),
      stepsJson: String(row.steps_json),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  return {
    async saveSession(row) {
      upsertSession.run(
        row.id,
        row.status,
        row.maxSteps,
        row.messagesJson,
        row.stepsJson,
        row.createdAt,
        row.updatedAt,
      );
    },
    async getSession(id) {
      const row = selectSession.get(id) as Record<string, unknown> | undefined;
      return row ? asSession(row) : undefined;
    },
    async listSessions() {
      const rows = selectSessions.all() as Record<string, unknown>[];
      return rows.map(asSession);
    },
    async appendEvent(event) {
      insertEvent.run(
        event.id,
        event.sessionId,
        event.type,
        event.payloadJson,
        event.createdAt,
      );
    },
    async listEvents(sessionId) {
      const rows = selectEvents.all(sessionId) as Record<string, unknown>[];
      return rows.map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        type: String(row.type),
        payloadJson: String(row.payload_json),
        createdAt: Number(row.created_at),
      }));
    },
    async saveCheckpoint(row) {
      insertCheckpoint.run(
        row.id,
        row.sessionId,
        row.stepId,
        row.stepType,
        row.messageCount,
        row.createdAt,
      );
    },
    async latestCheckpoint(sessionId) {
      const row = selectCheckpoint.get(sessionId) as
        | Record<string, unknown>
        | undefined;
      if (!row) return undefined;
      return {
        id: String(row.id),
        sessionId: String(row.session_id),
        stepId: row.step_id === null ? null : String(row.step_id),
        stepType: row.step_type === null ? null : String(row.step_type),
        messageCount: Number(row.message_count),
        createdAt: Number(row.created_at),
      };
    },
  };
}
