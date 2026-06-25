import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { RpcClient, sessionIdFromPath, type ConnectionStatus } from "../api/rpc";
import type { Attachment, Event, ImageContent, Model, PlanMode, SessionStats, StoredMessage, ThinkingLevel } from "../api/types";

const PERSONA_KEY = "pi-app:persona";
const DEFAULT_PERSONA = "coding";

function storedPersona(): string {
  try {
    return localStorage.getItem(PERSONA_KEY) ?? DEFAULT_PERSONA;
  } catch {
    return DEFAULT_PERSONA;
  }
}

export type ActivityState = "idle" | "thinking" | "tool" | "working" | "queued" | "reconnecting" | "connecting";

// A Block is one renderable unit in the transcript.
export type Block =
  | { id: string; kind: "user"; text: string; imageUrls?: string[]; queued?: boolean }
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
  queuedCount: number;
}

type Action =
  | { type: "user"; text: string; imageUrls?: string[]; queued?: boolean }
  | { type: "event"; event: Event }
  | { type: "load"; messages: StoredMessage[] }
  | { type: "reset" }
  | { type: "queue_sync"; steering: string[]; followUp: string[] };

let uid = 0;
const nextId = () => `b${++uid}`;

function planModeFromName(name: string | undefined): PlanMode {
  if (name?.endsWith("[impl]")) return "impl";
  if (name?.endsWith("[plan]")) return "plan";
  return "off";
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { blocks: [], streaming: false, queuedCount: 0 };

    case "user":
      return {
        ...state,
        blocks: [...state.blocks, { id: nextId(), kind: "user", text: action.text, imageUrls: action.imageUrls, queued: action.queued }],
      };

    case "queue_sync": {
      const queuedTexts = new Set([...action.steering, ...action.followUp]);
      const blocks = state.blocks.map((b) =>
        b.kind === "user" ? { ...b, queued: queuedTexts.has(b.text) } : b,
      );
      return { ...state, blocks, queuedCount: queuedTexts.size };
    }

    case "load":
      return { blocks: messagesToBlocks(action.messages), streaming: false, queuedCount: 0 };

    case "event":
      return handleEvent(state, action.event);
  }
}

function messagesToBlocks(messages: StoredMessage[] | null | undefined): Block[] {
  const blocks: Block[] = [];
  for (const m of messages ?? []) {
    if (m.role === "user") {
      blocks.push({ id: nextId(), kind: "user", text: textFromContent(m.content) });
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
      const text = textFromContent(m.content);
      const imgs = contentImages(m.content);
      const revIdx = [...blocks].reverse().findIndex((b) => b.kind === "tool" && b.toolId === m.toolCallId);
      if (revIdx >= 0) {
        const toolIdx = blocks.length - 1 - revIdx;
        const tool = blocks[toolIdx];
        if (tool.kind === "tool") {
          blocks[toolIdx] = { ...tool, result: text, isError: m.isError };
        }
      }
      for (const url of imgs) blocks.push({ id: nextId(), kind: "image", url });
    }
  }
  return blocks;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c?.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
}

function asArray(content: unknown): any[] {
  return Array.isArray(content) ? content : [];
}

function handleEvent(state: State, event: Event): State {
  switch (event.type) {
    case "agent_start":
      return { ...state, streaming: true };

    case "agent_end":
      return { ...state, streaming: false, queuedCount: 0 };

    case "queue_update":
      return reducer(state, { type: "queue_sync", steering: event.steering, followUp: event.followUp });

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
      const text = textFromContent(event.partialResult?.content);
      return updateTool(state, event.toolCallId, (b) => ({ ...b, result: text }));
    }

    case "tool_execution_end": {
      const text = textFromContent(event.result?.content);
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

function contentImages(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return (content as { type: string; data?: string; mimeType?: string }[])
    .filter((c) => c.type === "image" && c.data)
    .map((c) => `data:${c.mimeType ?? "image/png"};base64,${c.data}`);
}

function deriveActivity(streaming: boolean, status: ConnectionStatus, blocks: Block[], queuedCount: number): ActivityState {
  if (status === "connecting") return "connecting";
  if (status === "closed") return "reconnecting";
  if (!streaming) return queuedCount > 0 ? "queued" : "idle";
  const last = blocks[blocks.length - 1];
  if (last?.kind === "thinking") return "thinking";
  if (last?.kind === "tool" && !last.done) return "tool";
  return "working";
}

export function useSession() {
  const clientRef = useRef<RpcClient | null>(null);
  if (!clientRef.current) clientRef.current = new RpcClient();
  const client = clientRef.current;

  const [state, dispatch] = useReducer(reducer, { blocks: [], streaming: false, queuedCount: 0 });
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [initializing, setInitializing] = useState(true);
  const [model, setModel] = useState<Model | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [sessionName, setSessionName] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<string>(() => client.session);
  const [askMode, setAskMode] = useState(false);
  const [planMode, setPlanMode] = useState<PlanMode>("off");
  const [persona, setPersonaState] = useState(storedPersona);

  const loading = useRef(false);
  const buffer = useRef<Event[]>([]);
  const attachGen = useRef(0);
  const handleAgentEndRef = useRef<() => void>(() => {});
  const onAttachedRef = useRef<() => Promise<void>>(async () => {});

  const refreshStats = useCallback(async () => {
    const res = await client.request<SessionStats>({ type: "get_session_stats" });
    if (res.success && res.data) setStats(res.data);
  }, [client]);

  const loadMessages = useCallback(async () => {
    const res = await client.request<{ messages: StoredMessage[] }>({ type: "get_messages" });
    if (res.success && res.data?.messages) dispatch({ type: "load", messages: res.data.messages });
  }, [client]);

  const handleAgentEnd = useCallback(() => {
    void refreshStats();
    void loadMessages();
  }, [refreshStats, loadMessages]);

  handleAgentEndRef.current = handleAgentEnd;

  const flushEvents = useCallback(
    (events: Event[]) => {
      for (const event of events) {
        dispatch({ type: "event", event });
        if (event.type === "agent_end") handleAgentEnd();
      }
    },
    [handleAgentEnd],
  );

  useEffect(() => {
    const offEvent = client.onEvent((event) => {
      if (loading.current) {
        buffer.current.push(event);
        return;
      }
      dispatch({ type: "event", event });
      if (event.type === "agent_end") handleAgentEndRef.current();
    });
    const offStatus = client.onStatus((s) => {
      setStatus(s);
      if (s === "open") void onAttachedRef.current();
    });
    client.connect();
    return () => {
      offEvent();
      offStatus();
      client.close();
    };
  }, [client]);

  const refreshState = useCallback(async () => {
    const res = await client.request<{
      model: Model | null;
      thinkingLevel: ThinkingLevel;
      isStreaming?: boolean;
      sessionName?: string;
    }>({ type: "get_state" });
    if (res.success && res.data) {
      setModel(res.data.model);
      setThinkingLevel(res.data.thinkingLevel);
      setSessionName(res.data.sessionName);
      // The plan-mode extension reflects its phase in the session name suffix
      // ([plan]/[impl]); derive from it so reattaching/reloading restores the
      // toggle instead of silently resetting to off.
      setPlanMode(planModeFromName(res.data.sessionName));
      setInitializing(false);
      if (res.data.isStreaming) dispatch({ type: "event", event: { type: "agent_start" } });
    }
  }, [client]);

  const applyPersona = useCallback(
    async (name: string) => {
      await client.request({ type: "run_command", name: "persona", args: name });
      setPersonaState(name);
    },
    [client],
  );

  const setPersona = useCallback(
    async (name: string) => {
      await applyPersona(name);
      try {
        localStorage.setItem(PERSONA_KEY, name);
      } catch {
        /* ignore */
      }
    },
    [applyPersona],
  );

  const onAttached = useCallback(async () => {
    const gen = ++attachGen.current;
    loading.current = true;
    buffer.current = [];
    await Promise.all([
      refreshState(),
      refreshStats(),
      loadMessages(),
      applyPersona(storedPersona()),
    ]);
    if (gen !== attachGen.current) return;
    const queued = buffer.current;
    buffer.current = [];
    loading.current = false;
    flushEvents(queued);
  }, [flushEvents, loadMessages, refreshState, refreshStats, applyPersona]);

  onAttachedRef.current = onAttached;

  const sendPromptNow = useCallback(
    (text: string, attachments?: Attachment[], opts?: { streamingBehavior?: "steer" | "followUp" }) => {
      const images: ImageContent[] = (attachments ?? [])
        .filter((a) => a.kind === "image")
        .map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }));

      const textPrefix = (attachments ?? [])
        .filter((a) => a.kind === "text")
        .map((a) => `**${a.name}**\n\`\`\`\n${a.data}\n\`\`\`\n`)
        .join("\n");

      const message = textPrefix ? `${textPrefix}\n${text}` : text;
      const imageUrls = images.map((img) => `data:${img.mimeType};base64,${img.data}`);

      dispatch({
        type: "user",
        text,
        imageUrls: imageUrls.length ? imageUrls : undefined,
        queued: opts?.streamingBehavior === "followUp",
      });

      if (planMode === "plan") {
        client.send({ type: "run_command", name: "plan", args: message });
      } else {
        client.send({
          type: "prompt",
          message,
          ...(images.length ? { images } : {}),
          ...(opts?.streamingBehavior ? { streamingBehavior: opts.streamingBehavior } : {}),
        });
      }
    },
    [client, planMode],
  );

  const sendPrompt = useCallback(
    (text: string, attachments?: Attachment[]) => {
      if (state.streaming) {
        sendPromptNow(text, undefined, { streamingBehavior: "followUp" });
      } else {
        sendPromptNow(text, attachments);
      }
    },
    [state.streaming, sendPromptNow],
  );

  const cyclePlanMode = useCallback(async () => {
    if (planMode === "off") {
      setPlanMode("plan");
    } else if (planMode === "plan") {
      dispatch({ type: "user", text: "[implementing plan…]" });
      await client.request({ type: "run_command", name: "implement", args: "" });
      setPlanMode("impl");
    } else {
      await client.request({ type: "run_command", name: "done", args: "" });
      setPlanMode("off");
    }
  }, [client, planMode]);

  const abort = useCallback(() => {
    client.send({ type: "abort" });
  }, [client]);

  const resetForSession = useCallback(() => {
    dispatch({ type: "reset" });
    setModel(null);
    setThinkingLevel("medium");
    setSessionName(undefined);
    setStats(null);
    setAskMode(false);
    setPlanMode("off");
    setInitializing(true);
  }, []);

  const newSession = useCallback(async () => {
    resetForSession();
    client.switchTo(undefined);
    setSessionId(client.session);
  }, [client, resetForSession]);

  const switchSession = useCallback(
    async (sessionPath: string, historyMode: "push" | "replace" | "none" = "push") => {
      if (sessionPath === client.session && historyMode === "none") return;
      resetForSession();
      client.switchTo(sessionPath, historyMode);
      setSessionId(client.session);
    },
    [client, resetForSession],
  );

  useEffect(() => {
    const onPopState = () => {
      const id = sessionIdFromPath();
      if (!id || id === client.session) return;
      void switchSession(id, "none");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [client, switchSession]);

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

  const cycleThinking = useCallback(async () => {
    const res = await client.request<{ level: ThinkingLevel } | null>({ type: "cycle_thinking_level" });
    if (res.success && res.data) setThinkingLevel(res.data.level);
  }, [client]);

  const getAvailableModels = useCallback(async () => {
    const res = await client.request<{ models: Model[] }>({ type: "get_available_models" });
    return res.success && res.data ? res.data.models : [];
  }, [client]);

  const pickModel = useCallback(
    async (provider: string, modelId: string) => {
      await client.request({ type: "set_model", provider, modelId });
      await refreshState();
    },
    [client, refreshState],
  );

  const pickThinkingLevel = useCallback(
    async (level: ThinkingLevel) => {
      await client.request({ type: "set_thinking_level", level });
      await refreshState();
    },
    [client, refreshState],
  );

  const activity = useMemo(
    () => deriveActivity(state.streaming, status, state.blocks, state.queuedCount),
    [state.streaming, status, state.blocks, state.queuedCount],
  );

  return {
    sessionId,
    blocks: state.blocks,
    streaming: state.streaming,
    activity,
    queuedCount: state.queuedCount,
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
    getAvailableModels,
    pickModel,
    pickThinkingLevel,
    askMode,
    toggleAskMode,
    planMode,
    cyclePlanMode,
    persona,
    setPersona,
  };
}

export type Session = ReturnType<typeof useSession>;
