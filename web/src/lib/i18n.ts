/** Minimal i18n — swap strings object for locale files later. */
const strings = {
  activityThinking: "Thinking…",
  activityTool: "Running tool…",
  activityToolElapsed: (secs: number) => `${secs}s`,
  activityWorking: "Agent working…",
  activityReconnecting: "Reconnecting…",
  activityConnecting: "Connecting…",
  queueCountLabel: (n: number) => (n === 1 ? "1 queued" : `${n} queued`),
  queueSend: "Send",
  queueSendNow: "Send now",
  queueRemove: "Remove",
  queueEdit: "Edit",
  queueDragHandle: "Drag to reorder",
  composerPlaceholder: "Message pi…",
  composerPlaceholderQueue: "Queue a message…",
  personaTitle: "Persona",
  askMode: "ask",
  writeMode: "write",
  planMode: "plan",
  planModeActive: "planning",
  planEnter: "Enter plan mode (read-only)",
  planExit: "Exit plan mode — back to write",
  thinkingOff: "think",
  thinkingCycle: "Cycle thinking level",
  sessionsTitle: "Sessions",
  sessionsNew: "New session",
  sessionsRename: "Rename",
  sessionsRenameCurrent: "Rename current",
  sessionsResume: "Resume",
  sessionsSearchPlaceholder: "Search sessions…",
  sessionsShowMore: "Show more",
  sessionsNoMatches: "No matching sessions.",
  sessionsEmpty: "No saved sessions yet.",
  sessionsRunning: "Running",
} as const;

type StringKey = keyof typeof strings;
type FnKey = "queueCountLabel" | "activityToolElapsed";

export function t(key: FnKey, n: number): string;
export function t(key: Exclude<StringKey, FnKey>): string;
export function t(key: StringKey, arg?: number): string {
  const v = strings[key];
  if (typeof v === "function") return (v as (n: number) => string)(arg ?? 0);
  return v;
}
