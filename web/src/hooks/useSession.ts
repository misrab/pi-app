import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { RpcClient, type ConnectionStatus } from "../api/rpc";
import type { Attachment, Event, ImageContent, Model, PlanMode, SessionStats, StoredMessage, ThinkingLevel } from "../api/types";

// A Block is one renderable unit in the transcript.
export type Block =
  | { id: string; kind: "user"; text: string; imageUrls?: string[] }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "image"; url: string }
  | {
      id: string;
      kind: "tool";
      toolId: string;
      name: string;
      args: unknown;
      result?: string;
      isError?: boolean;
      done: boolean;
    };

interface State {
  blocks: Block[];
  streaming: boolean;
}

type Action =
  | { type: "user"; text: string; imageUrls?: string[] }
  | { type: "event"; event: Event }
  | { type: "load"; messages: StoredMessage[] }
  | { type: "reset" };

let uid = 0;
const nextId = () => `b${++uid}`;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { blocks: [], streaming: false };

    case "user":
      return { ...state, blocks: [...state.blocks, { id: nextId(), kind: "user", text: action.text, imageUrls: action.imageUrls }] };

    case "load":
      return { blocks: messagesToBlocks(action.messages), streaming: false };

    case "event":
      return handleEvent(state, action.event);
  }
}

// messagesToBlocks rebuilds the transcript from stored messages (on resume).
function messagesToBlocks(messages: StoredMessage[] | null | undefined): Block[] {
  const blocks: Block[] = [];
  for (const m of messages ?? []) {
    if (m.role === "user") {
      blocks.push({ id: nextId(), kind: "user", text: contentToText(m.content) });
    } else if (m.role === "assistant") {
      for (const c of asArray(m.content)) {
        if (c?.type === "text" && c.text) {
          blocks.push({ id: nextId(), kind: "text", text: c.text });
        } else if (c?.type === "thinking" && c.thinking) {
          blocks.push({ id: nextId(), kind: "thinking", text: c.thinking });
        } else if (c?.type === "toolCall") {
          blocks.push({
            id: nextId(),
            kind: "tool",
            toolId: c.id ?? nextId(),
            name: c.name ?? "tool",
            args: c.arguments,
            done: true,
          });
        }
      }
    } else if (m.role === "toolResult") {
      const text = contentToText(m.content);
      const imgs = contentImages(m.content);
      const tool = [...blocks].reverse().find((b) => b.kind === "tool" && b.toolId === m.toolCallId);
      if (tool && tool.kind === "tool") {
        tool.result = text;
        tool.isError = m.isError;
      }
      for (const url of imgs) blocks.push({ id: nextId(), kind: "image", url });
    }
  }
  return blocks;
}

function asArray(content: unknown): any[] {
  return Array.isArray(content) ? content : [];
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  return asArray(content)
    .filter((c) => c?.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
}

function handleEvent(state: State, event: Event): State {
  switch (event.type) {
    case "agent_start":
      return { ...state, streaming: true };

    case "agent_end":
      return { ...state, streaming: false };

    case "message_update": {
      const d = event.assistantMessageEvent;
      const blocks = state.blocks.slice();
      const last = blocks[blocks.length - 1];

      if (d.type === "text_delta") {
        if (last?.kind === "text") {
          blocks[blocks.length - 1] = { ...last, text: last.text + d.delta };
        } else {
          blocks.push({ id: nextId(), kind: "text", text: d.delta });
        }
      } else if (d.type === "thinking_delta") {
        if (last?.kind === "thinking") {
          blocks[blocks.length - 1] = { ...last, text: last.text + d.delta };
        } else {
          blocks.push({ id: nextId(), kind: "thinking", text: d.delta });
        }
      } else {
        return state;
      }
      return { ...state, blocks };
    }

    case "tool_execution_start": {
      const blocks = [
        ...state.blocks,
        {
          id: nextId(),
          kind: "tool" as const,
          toolId: event.toolCallId,
          name: event.toolName,
          args: event.args,
          done: false,
        },
      ];
      return { ...state, blocks };
    }

    case "tool_execution_update": {
      const text = extractText(event.partialResult?.content);
      return updateTool(state, event.toolCallId, (b) => ({ ...b, result: text }));
    }

    case "tool_execution_end": {
      const text = extractText(event.result?.content);
      const imgs = contentImages(event.result?.content);
      let next = updateTool(state, event.toolCallId, (b) => ({
        ...b,
        result: text,
        isError: event.isError,
        done: true,
      }));
      for (const url of imgs) {
        next = { ...next, blocks: [...next.blocks, { id: nextId(), kind: "image" as const, url }] };
      }
      return next;
    }

    default:
      return state;
  }
}

function updateTool(state: State, toolId: string, fn: (b: Extract<Block, { kind: "tool" }>) => Block): State {
  const blocks = state.blocks.map((b) => (b.kind === "tool" && b.toolId === toolId ? fn(b) : b));
  return { ...state, blocks };
}

function extractText(content?: { type: string; text?: string; data?: string; mimeType?: string }[]): string {
  if (!content) return "";
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
}

// Extract image content blocks from any content array and convert to data-URIs.
function contentImages(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return (content as { type: string; data?: string; mimeType?: string }[])
    .filter((c) => c.type === "image" && c.data)
    .map((c) => `data:${c.mimeType ?? "image/png"};base64,${c.data}`);
}

export function useSession() {
  const clientRef = useRef<RpcClient | null>(null);
  if (!clientRef.current) clientRef.current = new RpcClient();
  const client = clientRef.current;

  const [state, dispatch] = useReducer(reducer, { blocks: [], streaming: false });
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [initializing, setInitializing] = useState(true); // true until first model loads
  const [model, setModel] = useState<Model | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [sessionName, setSessionName] = useState<string | undefined>();
  const [askMode, setAskMode] = useState(false);
  const [planMode, setPlanMode] = useState<PlanMode>("off");

  // On every (re)attach we rebuild the transcript from committed history
  // (get_messages). While that async load is in flight, live events are buffered
  // so they are not wiped by the subsequent "load" dispatch, then flushed in
  // arrival order. get_messages is authoritative: we reconcile to it again on
  // agent_end so any streaming race (e.g. a mid-stream reconnect) self-heals.
  const loading = useRef(false);
  const buffer = useRef<Event[]>([]);

  // Wire up the client once.
  useEffect(() => {
    const offEvent = client.onEvent((event) => {
      if (loading.current) {
        buffer.current.push(event);
        return;
      }
      dispatch({ type: "event", event });
      if (event.type === "agent_end") {
        void refreshStats();
        void loadMessages(); // reconcile to authoritative committed state
        // Flush one queued message if present.
        const next = promptQueue.current.shift();
        if (next) sendPromptNow(next);
      }
    });
    const offStatus = client.onStatus((s) => {
      setStatus(s);
      if (s === "open") void onAttached();
    });
    client.connect();
    return () => {
      offEvent();
      offStatus();
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // onAttached runs after the socket (re)opens: load committed history, then
  // flush any events buffered during the load (replay + live).
  const onAttached = useCallback(async () => {
    loading.current = true;
    buffer.current = [];
    await Promise.all([refreshState(), refreshStats(), loadMessages()]);
    const queued = buffer.current;
    buffer.current = [];
    loading.current = false;
    for (const event of queued) {
      dispatch({ type: "event", event });
      if (event.type === "agent_end") {
        void refreshStats();
        void loadMessages();
        const next = promptQueue.current.shift();
        if (next) sendPromptNow(next);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const refreshState = useCallback(async () => {
    const res = await client.request<{
      model: Model | null;
      thinkingLevel: ThinkingLevel;
      sessionName?: string;
    }>({ type: "get_state" });
    if (res.success && res.data) {
      setModel(res.data.model);
      setThinkingLevel(res.data.thinkingLevel);
      setSessionName(res.data.sessionName);
      setInitializing(false);
    }
  }, [client]);

  const refreshStats = useCallback(async () => {
    const res = await client.request<SessionStats>({ type: "get_session_stats" });
    if (res.success && res.data) setStats(res.data);
  }, [client]);

  const sendPromptNow = useCallback(
    (text: string, attachments?: Attachment[]) => {
      const images: ImageContent[] = (attachments ?? [])
        .filter((a) => a.kind === "image")
        .map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }));

      // Text-file attachments: prepend each as a fenced code block.
      const textPrefix = (attachments ?? [])
        .filter((a) => a.kind === "text")
        .map((a) => `**${a.name}**\n\`\`\`\n${a.data}\n\`\`\`\n`)
        .join("\n");

      const message = textPrefix ? `${textPrefix}\n${text}` : text;
      const imageUrls = images.map((img) => `data:${img.mimeType};base64,${img.data}`);

      dispatch({ type: "user", text, imageUrls: imageUrls.length ? imageUrls : undefined });

      if (planMode === "plan") {
        client.send({ type: "run_command", name: "plan", args: message });
      } else {
        client.send({
          type: "prompt",
          message,
          ...(images.length ? { images } : {}),
        });
      }
    },
    [client, planMode],
  );

  const sendPrompt = useCallback(
    (text: string, attachments?: Attachment[]) => {
      if (state.streaming) {
        // Queue the message — it will be sent when the current turn ends.
        // Attachments are not queued (same as Claude — send now would be confusing).
        promptQueue.current.push(text);
        dispatch({ type: "user", text });
      } else {
        sendPromptNow(text, attachments);
      }
    },
    [state.streaming, sendPromptNow],
  );

  const cyclePlanMode = useCallback(async () => {
    if (planMode === "off") {
      // Enter plan mode — tools go read-only via the extension.
      // User will type the task and send it; sendPrompt intercepts it.
      setPlanMode("plan");
    } else if (planMode === "plan") {
      // Switch to implement: run the /implement command which reads the latest plan.
      dispatch({ type: "user", text: "[implementing plan…]" });
      await client.request({ type: "run_command", name: "implement", args: "" });
      setPlanMode("impl");
    } else {
      // Done: exit plan mode.
      await client.request({ type: "run_command", name: "done", args: "" });
      setPlanMode("off");
    }
  }, [client, planMode]);

  // Queue of messages submitted while the agent is streaming.
  const promptQueue = useRef<string[]>([]);

  const abort = useCallback(() => {
    client.send({ type: "abort" });
    // Optimistically clear streaming — agent_end may not fire if the SDK swallows it.
    dispatch({ type: "event", event: { type: "agent_end" } as Event });
    promptQueue.current = []; // discard any queued messages on abort
  }, [client]);

  // Start a fresh session by re-attaching the socket with no session id; the
  // backend spawns a new pi process (unify-on-attach). The open handler then
  // loads (empty) history; loadMessages is a no-op for a fresh session.
  const newSession = useCallback(async () => {
    dispatch({ type: "reset" });
    setStats(null);
    setPlanMode("off");
    client.switchTo(undefined);
  }, [client]);

  // Load the current conversation's messages into the transcript.
  const loadMessages = useCallback(async () => {
    const res = await client.request<{ messages: StoredMessage[] }>({ type: "get_messages" });
    if (res.success && res.data?.messages) dispatch({ type: "load", messages: res.data.messages });
  }, [client]);

  // Switch sessions by re-attaching the socket to the target id (unify-on-
  // attach). The previous session's pi process keeps running in the background.
  const switchSession = useCallback(
    async (sessionPath: string) => {
      dispatch({ type: "reset" });
      client.switchTo(sessionPath);
      return true;
    },
    [client],
  );

  // Hard-stop a session's pi process (the file persists for cold resume).
  const stopSession = useCallback(async (sessionPath: string) => {
    await fetch(`/api/sessions/stop?id=${encodeURIComponent(sessionPath)}`, { method: "POST" });
  }, []);

  const renameSession = useCallback(
    async (name: string) => {
      await client.request({ type: "set_session_name", name });
      await refreshState();
    },
    [client, refreshState],
  );

  const toggleAskMode = useCallback(async () => {
    await client.request({ type: "run_command", name: "ask", args: "" });
    setAskMode((prev) => !prev);
  }, [client]);

  // Cycle thinking level (mirrors the CLI's shift+tab).
  const cycleThinking = useCallback(async () => {
    const res = await client.request<{ level: ThinkingLevel } | null>({ type: "cycle_thinking_level" });
    if (res.success && res.data) setThinkingLevel(res.data.level);
  }, [client]);

  return {
    client,
    blocks: state.blocks,
    streaming: state.streaming,
    status,
    initializing,
    model,
    thinkingLevel,
    stats,
    sessionName,
    sendPrompt,
    abort,
    newSession,
    switchSession,
    stopSession,
    renameSession,
    cycleThinking,
    askMode,
    toggleAskMode,
    planMode,
    cyclePlanMode,
    refreshState,
    refreshStats,
  };
}

export type Session = ReturnType<typeof useSession>;
