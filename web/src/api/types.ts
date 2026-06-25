// Typed subset of pi's RPC protocol.
// See: pi-coding-agent/docs/rpc.md

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type PlanMode = "off" | "plan" | "impl";

export interface Model {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
}

// ---- Messages -------------------------------------------------------------

export interface TextContent {
  type: "text";
  text: string;
}
export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}
export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
}
export type AssistantContent = TextContent | ThinkingContent | ToolCallContent;

// ---- Commands (client -> pi) ---------------------------------------------

export type Command =
  | { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
  | { id?: string; type: "steer"; message: string }
  | { id?: string; type: "follow_up"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "new_session" }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "get_messages" }
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "cycle_model" }
  | { id?: string; type: "get_available_models" }
  | { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
  | { id?: string; type: "cycle_thinking_level" }
  | { id?: string; type: "compact"; customInstructions?: string }
  | { id?: string; type: "set_auto_compaction"; enabled: boolean }
  | { id?: string; type: "get_session_stats" }
  | { id?: string; type: "switch_session"; sessionPath: string }
  | { id?: string; type: "fork"; entryId: string }
  | { id?: string; type: "clone" }
  | { id?: string; type: "get_fork_messages" }
  | { id?: string; type: "set_session_name"; name: string }
  | { id?: string; type: "get_commands" }
  | { id?: string; type: "run_command"; name: string; args: string };

export interface ImageContent {
  type: "image";
  /** Raw base64 (no data-URI prefix). */
  data: string;
  mimeType: string;
}

/** A file the user has attached before sending a prompt. */
export interface Attachment {
  /** Client-side stable key for React lists / removal. */
  id: string;
  name: string;
  kind: "image" | "text";
  mimeType: string;
  /** Raw base64 for images; UTF-8 text string for text files. */
  data: string;
  /** data-URI for image preview thumbnails. Empty string for text files. */
  previewUrl: string;
}

// ---- Responses (pi -> client, correlated by id) --------------------------

export interface Response<T = unknown> {
  type: "response";
  id?: string;
  command: string;
  success: boolean;
  error?: string;
  data?: T;
}

// ---- Events (pi -> client, streamed) -------------------------------------

export type AssistantDelta =
  | { type: "start" }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number }
  | { type: "toolcall_start"; contentIndex: number }
  | { type: "toolcall_delta"; contentIndex: number }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallContent }
  | { type: "done"; reason: "stop" | "length" | "toolUse" }
  | { type: "error"; reason: "aborted" | "error" };

export type Event =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: unknown[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: unknown; toolResults: unknown[] }
  | { type: "message_start"; message: unknown }
  | { type: "message_end"; message: unknown }
  | { type: "message_update"; message: unknown; assistantMessageEvent: AssistantDelta }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: ToolResult }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: ToolResult; isError: boolean }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | { type: "compaction_start"; reason: string }
  | { type: "compaction_end"; reason: string; aborted: boolean }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number };

export interface ToolResult {
  content: { type: string; text?: string }[];
  details?: unknown;
}

// Either a response or an event arrives on the wire.
export type Incoming = Response | Event;

// ---- State (from get_state / get_session_stats) --------------------------

export interface SessionState {
  model: Model | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionId: string;
  sessionFile?: string; // path to the session's .jsonl (used to reattach)
  sessionName?: string;
  messageCount: number;
}

export interface SessionStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface ForkMessage {
  entryId: string;
  text: string;
}

export interface PiCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
}

// Live process status for a session (from the backend manager).
export type SessionRunStatus = "running" | "idle" | "stopped";

// Saved session listing (from the backend /api/sessions endpoint).
// `id` is pi's stable session id, used to (re)attach the WebSocket.
export interface SessionInfo {
  id: string;
  name: string;
  modified: string;
  preview: string;
  status: SessionRunStatus;
  attached: number;
}

// A message loaded from get_messages when resuming a session.
export interface StoredMessage {
  role: "user" | "assistant" | "toolResult" | string;
  content: unknown;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}
