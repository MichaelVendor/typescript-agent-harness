import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type Role = "owner" | "member";

export type Store = {
  createUser(username: string, passwordHash: string): { id: string };
  userByName(username: string): { id: string; username: string; passwordHash: string } | undefined;
  createProject(ownerId: string, name: string): { id: string; name: string };
  projectsFor(userId: string): { id: string; name: string; role: Role }[];
  addMember(projectId: string, userId: string, role: Role): void;
  role(projectId: string, userId: string): Role | undefined;
  audit(row: { userId: string; projectId: string; route: string; status: number }): void;
};

export function openStore(file: string): Store {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      route TEXT NOT NULL,
      status INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const insertUser = db.prepare(`INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)`);
  const selectUserByName = db.prepare(`SELECT id, username, password_hash FROM users WHERE username = ?`);
  const insertProject = db.prepare(`INSERT INTO projects (id, name, owner_id) VALUES (?, ?, ?)`);
  const insertMember = db.prepare(`INSERT INTO members (project_id, user_id, role) VALUES (?, ?, ?)`);
  const selectProjectsFor = db.prepare(`
    SELECT p.id, p.name, m.role
    FROM members m
    JOIN projects p ON p.id = m.project_id
    WHERE m.user_id = ?
  `);
  const selectRole = db.prepare(`SELECT role FROM members WHERE project_id = ? AND user_id = ?`);
  const insertAudit = db.prepare(
    `INSERT INTO audit (id, user_id, project_id, route, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  return {
    createUser(username, passwordHash) {
      const id = randomUUID();
      insertUser.run(id, username, passwordHash);
      return { id };
    },
    userByName(username) {
      const row = selectUserByName.get(username) as
        | { id: string; username: string; password_hash: string }
        | undefined;
      if (!row) return undefined;
      return { id: row.id, username: row.username, passwordHash: row.password_hash };
    },
    createProject(ownerId, name) {
      const id = randomUUID();
      insertProject.run(id, name, ownerId);
      insertMember.run(id, ownerId, "owner");
      return { id, name };
    },
    projectsFor(userId) {
      const rows = selectProjectsFor.all(userId) as { id: string; name: string; role: Role }[];
      return rows.map((row) => ({ id: row.id, name: row.name, role: row.role }));
    },
    addMember(projectId, userId, role) {
      insertMember.run(projectId, userId, role);
    },
    role(projectId, userId) {
      const row = selectRole.get(projectId, userId) as { role: Role } | undefined;
      return row?.role;
    },
    audit(row) {
      insertAudit.run(randomUUID(), row.userId, row.projectId, row.route, row.status, Date.now());
    },
  };
}
