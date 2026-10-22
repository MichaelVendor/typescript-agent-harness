export type PersistedSession = {
  id: string;
  status: string;
  maxSteps: number;
  messagesJson: string;
  stepsJson: string;
  createdAt: number;
  updatedAt: number;
};

/** List row. Carries the head of `messages_json`, never `steps_json`. */
export type SessionSummary = {
  id: string;
  status: string;
  maxSteps: number;
  messagesHead: string;
  messagesChars: number;
  createdAt: number;
  updatedAt: number;
};

export type PersistedEvent = {
  id: string;
  sessionId: string;
  type: string;
  payloadJson: string;
  createdAt: number;
};

export type PersistedCheckpoint = {
  id: string;
  sessionId: string;
  stepId: string | null;
  stepType: string | null;
  messageCount: number;
  createdAt: number;
};

export type StorageService = {
  saveSession(row: PersistedSession): Promise<void>;
  getSession(id: string): Promise<PersistedSession | undefined>;
  /** Existence check that does not read the session row. */
  hasSession(id: string): Promise<boolean>;
  listSessions(): Promise<SessionSummary[]>;
  appendEvent(event: PersistedEvent): Promise<void>;
  listEvents(sessionId: string): Promise<PersistedEvent[]>;
  saveCheckpoint(row: PersistedCheckpoint): Promise<void>;
  latestCheckpoint(sessionId: string): Promise<PersistedCheckpoint | undefined>;
};
