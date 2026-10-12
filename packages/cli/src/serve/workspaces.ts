import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ChatHost, HostEvent } from "../host.js";
import { setSessionFlag, type SessionFlag } from "../session-flags.js";
import { setSessionTitle } from "../session-titles.js";
import type { SessionRow } from "../sessions.js";
import { addWorkspace, loadWorkspaces, removeWorkspace } from "../workspaces.js";
import { BusyError, type Hub } from "./hub.js";
import type { WorkspaceView } from "./protocol.js";

/** Answered as HTTP 409. */
export class ConflictError extends Error {}

export type Workspaces = {
  readonly cwd: string;
  readonly host: ChatHost;
  list(): Promise<WorkspaceView[]>;
  add(dir: string): void;
  remove(dir: string): void;
  /** Opens `dir` and moves every tab to it; false when it already was current. On failure the current folder stays. */
  activate(dir: string): Promise<boolean>;
  renameSession(cwd: string | undefined, id: string, title: string): Promise<string | undefined>;
  setSessionFlag(cwd: string | undefined, id: string, flag: SessionFlag, on: boolean): Promise<void>;
  close(): Promise<void>;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One open `ChatHost` at a time; `host` must already be open. */
export function createWorkspaces(opts: {
  cwd: string;
  home: string;
  host: ChatHost;
  hub: Hub;
  createHost(cwd: string): Promise<ChatHost>;
  readSessions(cwd: string): Promise<SessionRow[]>;
}): Workspaces {
  let current = { cwd: path.resolve(opts.cwd), host: opts.host };
  let switching = false;
  addWorkspace(opts.home, current.cwd);

  const listed = (dir: string): string => {
    const target = path.resolve(dir);
    if (target !== current.cwd && !loadWorkspaces(opts.home).includes(target)) {
      throw new Error(`not in the folder list: ${target}`);
    }
    return target;
  };

  /** Other folders: check the session exists in their db before writing their sidebar files. */
  const other = async (cwd: string | undefined, id: string): Promise<string | undefined> => {
    if (cwd === undefined) return undefined;
    const target = listed(cwd);
    if (target === current.cwd) return undefined;
    if (!(await opts.readSessions(target)).some((r) => r.id === id)) throw new Error(`no session "${id}"`);
    return target;
  };

  return {
    get cwd() {
      return current.cwd;
    },
    get host() {
      return current.host;
    },
    async list() {
      const dirs = loadWorkspaces(opts.home);
      if (!dirs.includes(current.cwd)) dirs.unshift(current.cwd);
      return Promise.all(
        dirs.map(async (dir): Promise<WorkspaceView> => {
          const view = { path: dir, name: path.basename(dir) || dir, active: dir === current.cwd };
          if (view.active) return { ...view, sessions: await current.host.listSessions() };
          if (!existsSync(dir)) return { ...view, missing: true, sessions: [] };
          try {
            return { ...view, sessions: await opts.readSessions(dir) };
          } catch (err) {
            return { ...view, error: message(err), sessions: [] };
          }
        }),
      );
    },
    add(dir) {
      const target = path.resolve(dir);
      if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`not a folder: ${target}`);
      addWorkspace(opts.home, target);
    },
    remove(dir) {
      const target = path.resolve(dir);
      if (target === current.cwd) throw new ConflictError("the active folder cannot be removed — switch to another first");
      removeWorkspace(opts.home, target);
    },
    async activate(dir) {
      const target = listed(dir);
      if (target === current.cwd) return false;
      opts.hub.assertIdle();
      if (switching) throw new BusyError();
      switching = true;
      try {
        const next = await opts.createHost(target);
        const buffered: HostEvent[] = [];
        const off = next.on((event) => buffered.push(event));
        try {
          await next.open();
        } catch (err) {
          off();
          await next.close().catch(() => {});
          throw err;
        }
        off();
        try {
          opts.hub.swap(next, buffered);
        } catch (err) {
          await next.close().catch(() => {});
          throw err;
        }
        const previous = current;
        current = { cwd: target, host: next };
        try {
          await previous.host.close();
        } catch (err) {
          console.error(`[tah] closing ${previous.cwd} failed: ${message(err)}`);
        }
        return true;
      } finally {
        switching = false;
      }
    },
    async renameSession(cwd, id, title) {
      const target = await other(cwd, id);
      return target ? setSessionTitle(target, id, title) : current.host.renameSession(id, title);
    },
    async setSessionFlag(cwd, id, flag, on) {
      const target = await other(cwd, id);
      if (target) setSessionFlag(target, id, flag, on);
      else await current.host.setSessionFlag(id, flag, on);
    },
    close: () => current.host.close(),
  };
}
