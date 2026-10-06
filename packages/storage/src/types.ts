export type PersistedSession = {
  id: string;
  status: string;
  maxSteps: number;
  messagesJson: string;
  stepsJson: string;
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
  listSessions(): Promise<PersistedSession[]>;
  appendEvent(event: PersistedEvent): Promise<void>;
  listEvents(sessionId: string): Promise<PersistedEvent[]>;
  saveCheckpoint(row: PersistedCheckpoint): Promise<void>;
  latestCheckpoint(sessionId: string): Promise<PersistedCheckpoint | undefined>;
};
