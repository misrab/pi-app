/** Minimal i18n — swap strings object for locale files later. */
const strings = {
  appName: "pi",
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
  composerUnsupportedPrefix: "Can't attach:",
  composerUnsupportedSuffix: "— images & text files only",
  composerDropToAttach: "Drop to attach",
  composerAttachFile: "Attach file",
  composerAttachFileTitle: "Attach image or text file",
  composerDictate: "Dictate",
  composerStopDictation: "Stop dictation",
  composerStop: "Stop",
  composerRemoveAttachment: (name: string) => `Remove ${name}`,
  personaTitle: "Persona",
  askMode: "ask",
  writeMode: "write",
  planMode: "plan",
  planModeActive: "planning",
  planEnter: "Enter plan mode (read-only)",
  planExit: "Exit plan mode — back to write",
  askModeTooltip: "Ask mode — read-only, no file writes",
  thinkingOff: "think",
  thinkingCycle: "Cycle thinking level",
  thinkingSection: "Thinking",
  modelTitle: "Model",
  modelNone: "no model",
  sessionsTitle: "Sessions",
  sidebarResize: "Resize sidebar",
  sessionsNew: "New session",
  sessionsRename: "Rename",
  sessionsRenameCurrent: "Rename current",
  sessionsRenameDialogTitle: "Rename session",
  sessionsRenamePlaceholder: "Session name",
  sessionsResume: "Resume",
  sessionsSearchPlaceholder: "Search sessions…",
  sessionsShowMore: "Show more",
  sessionsNoMatches: "No matching sessions.",
  sessionsEmpty: "No saved sessions yet.",
  sessionsRunning: "Running",
  sessionsActions: "Session actions",
  sessionsPin: "Pin",
  sessionsUnpin: "Unpin",
  sessionsPinned: "Pinned",
  sessionsDelete: "Delete",
  sessionsDeleteTitle: "Delete session?",
  sessionsDeleteBody: "Permanently delete this session and its history? This cannot be undone.",
  filesTitle: "Files",
  filesOpen: "Browse files",
  filesUp: "Up",
  filesEmpty: "Empty folder.",
  filesBinary: "Binary file — not shown.",
  filesTruncated: "Truncated — file is larger than shown.",
  filesError: "Could not open — try again.",
  filesRoot: "workspace",
  diffNewFile: "new file",
  diffExpand: "Show full diff",
  diffCollapse: "Collapse",
  statCost: "Cost",
  statTokens: "Tokens",
  statContext: "Context",
  statTokensTitle: (input: string, output: string, cache: string) =>
    `Input: ${input} · Output: ${output} · Cache read: ${cache}`,
  statusRunning: "running",
  statusIdle: "idle",
  statusStopped: "stopped",
  relativeNow: "now",
  close: "Close",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  copy: "Copy",
  copyDone: "✓",
  transcriptEmpty: "Start a conversation with pi.",
  jumpLatest: "↓ Latest",
  jumpLatestLabel: "Jump to latest",
  artifactPreview: (lang: string) => `${lang.toUpperCase()} preview`,
  artifactShowPreview: "Preview",
  artifactShowCode: "Code",
  mermaidError: "mermaid error:",
  toolNoOutput: "(no output)",
  ariaYou: "You",
  ariaPi: "pi",
  ariaAttachment: "attachment",
  ariaGeneratedImage: "Generated image",
  headerMenu: "Sessions",
  themeLight: "Switch to light mode",
  themeDark: "Switch to dark mode",
  connectionStatus: (status: string) => `Connection ${status}`,
} as const;

type StringKey = keyof typeof strings;
type FnKey =
  | "queueCountLabel"
  | "activityToolElapsed"
  | "composerRemoveAttachment"
  | "artifactPreview"
  | "connectionStatus";

export function formatStatTokensTitle(input: string, output: string, cache: string): string {
  return strings.statTokensTitle(input, output, cache);
}

export function t(key: FnKey, arg: string): string;
export function t(key: "queueCountLabel" | "activityToolElapsed", n: number): string;
export function t(key: Exclude<StringKey, FnKey>): string;
export function t(key: StringKey, arg?: string | number): string {
  const v = strings[key];
  if (typeof v === "function") {
    if (key === "queueCountLabel" || key === "activityToolElapsed") {
      return (v as (n: number) => string)(arg as number ?? 0);
    }
    return (v as (a: string) => string)(arg as string ?? "");
  }
  return v;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** Locale-aware relative time for session list. */
export function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("relativeNow");
  if (mins < 60) return rtf.format(-mins, "minute");
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return rtf.format(-hrs, "hour");
  return rtf.format(-Math.round(hrs / 24), "day");
}
