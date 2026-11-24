/**
 * Project team roster → `<cwd>/tah.team.json`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type TeamMember = { id: string; displayName: string; persona: string };

export type TeamSettingsView = { members: TeamMember[] };

export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  {
    id: "tl",
    displayName: "TL",
    persona: "Leads the team, delegates work, and synthesizes outcomes.",
  },
  {
    id: "researcher",
    displayName: "Researcher",
    persona: "Finds facts, sources, and short briefs for the team.",
  },
];

function teamPath(cwd: string): string {
  return path.join(cwd, "tah.team.json");
}

function parseMember(raw: unknown): TeamMember | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.displayName !== "string") return null;
  if (typeof o.persona !== "string") return null;
  return { id: o.id.trim(), displayName: o.displayName, persona: o.persona };
}

function validateMembers(members: unknown): TeamMember[] {
  if (!Array.isArray(members)) throw new Error('"members" must be an array');
  const out: TeamMember[] = [];
  const ids = new Set<string>();
  for (const item of members) {
    const m = parseMember(item);
    if (!m) throw new Error("each member needs id, displayName, and persona strings");
    if (ids.has(m.id)) throw new Error(`duplicate member id: ${m.id}`);
    ids.add(m.id);
    out.push(m);
  }
  if (!ids.has("tl")) throw new Error('team must include a member with id "tl"');
  return out;
}

export function loadTeamSettings(cwd: string): TeamMember[] {
  const file = teamPath(cwd);
  if (!existsSync(file)) return [...DEFAULT_TEAM_MEMBERS];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { members?: unknown };
    if (!Array.isArray(raw.members)) return [...DEFAULT_TEAM_MEMBERS];
    const members = raw.members.map(parseMember).filter((m): m is TeamMember => m !== null);
    if (!members.some((m) => m.id === "tl")) return [...DEFAULT_TEAM_MEMBERS];
    const ids = new Set<string>();
    for (const m of members) {
      if (ids.has(m.id)) return [...DEFAULT_TEAM_MEMBERS];
      ids.add(m.id);
    }
    return members;
  } catch {
    return [...DEFAULT_TEAM_MEMBERS];
  }
}

export function teamSettingsView(cwd: string): TeamSettingsView {
  return { members: loadTeamSettings(cwd) };
}

export function saveTeamSettings(cwd: string, members: unknown): TeamSettingsView {
  const validated = validateMembers(members);
  writeFileSync(teamPath(cwd), `${JSON.stringify({ members: validated }, null, 2)}\n`);
  return { members: validated };
}