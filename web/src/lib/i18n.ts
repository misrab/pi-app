/** Minimal i18n — swap strings object for locale files later. */
const strings = {
  activityThinking: "Thinking…",
  activityTool: "Running tool…",
  activityWorking: "Working…",
  activityQueued: (n: number) => (n === 1 ? "1 message queued" : `${n} messages queued`),
  activityReconnecting: "Reconnecting…",
  activityConnecting: "Connecting…",
  activityReady: "Ready",
  queuedBadge: "queued",
  personaTitle: "Persona",
  askMode: "ask",
  writeMode: "write",
  planMode: "plan",
  planModeActive: "planning",
  planEnter: "Enter plan mode (read-only)",
  planExit: "Exit plan mode — back to write",
  thinkingOff: "think",
  thinkingCycle: "Cycle thinking level",
} as const;

type StringKey = keyof typeof strings;

export function t(key: "activityQueued", n: number): string;
export function t(key: Exclude<StringKey, "activityQueued">): string;
export function t(key: StringKey, arg?: number): string {
  const v = strings[key];
  if (typeof v === "function") return v(arg ?? 0);
  return v;
}
