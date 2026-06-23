// Lists saved sessions for the resume UI, annotated with live status from the
// manager. Session identity is pi's session id (stable across reconnects).
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Manager, Status } from "./manager.js";

export interface SessionListItem {
  id: string;
  name: string;
  preview: string;
  modified: string;
  status: Status | "stopped";
  attached: number;
}

export async function listSessions(cwd: string, manager: Manager): Promise<SessionListItem[]> {
  const saved = await SessionManager.list(cwd);

  const live = new Map<string, { status: Status; attached: number }>();
  for (const s of manager.list()) live.set(s.id, s);

  return saved.map((s: any): SessionListItem => {
    const l = live.get(s.id);
    return {
      id: s.id,
      name: s.name || clip(s.firstMessage) || s.id,
      preview: clip(s.firstMessage),
      modified: new Date(s.modified).toISOString(),
      status: l ? l.status : "stopped",
      attached: l ? l.attached : 0,
    };
  });
}

function clip(s: string | undefined): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}
