import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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

export type QueueItem = {
  id: string;
  text: string;
  attachments?: Attachment[];
};

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

/** Apply replay/history without clobbering in-flight turn state. */
function mergeLoadedMessages(state: State, messages: StoredMessage[]): State {
  return { blocks: messagesToBlocks(messages), streaming: state.streaming };
}

let uid = 0;
let queueUid = 0;
const nextId = () => `b${++uid}`;
const nextQueueId = () => `q${++queueUid}`;

function planModeFromName(name: string | undefined): PlanMode {
  return name?.includes("[plan]") ? "on" : "off";
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { blocks: [], streaming: false };

    case "user":
      return {
        ...state,
        blocks: [...state.blocks, { id: nextId(), kind: "user", text: action.text, imageUrls: action.imageUrls }],
      };

    case "load":
      return mergeLoadedMessages(state, action.messages);

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

export function useSession() {
  const clientRef = useRef<RpcClient | null>(null);
  if (!clientRef.current) clientRef.current = new RpcClient();
  const client = clientRef.current;

  const [state, dispatch] = useReducer(reducer, { blocks: [], streaming: false });
  const [queue, setQueueState] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
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
  // Set when the user hits stop. The server emits the same agent_end for an
  // abort as for a natural finish, so this flag lets us tell them apart and
  // skip advancing the queue on a manual stop.
  const stoppedRef = useRef(false);
  const handleAgentEndRef = useRef<() => void>(() => {});
  const onAttachedRef = useRef<() => Promise<void>>(async () => {});
  const sendPromptNowRef = useRef<(text: string, attachments?: Attachment[], opts?: { streamingBehavior?: "steer" }) => void>(() => {});

  const setQueue = useCallback((updater: QueueItem[] | ((prev: QueueItem[]) => QueueItem[])) => {
    setQueueState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      queueRef.current = next;
      return next;
    });
  }, []);

  const refreshStats = useCallback(async () => {
    const res = await client.request<SessionStats>({ type: "get_session_stats" });
    if (res.success && res.data) setStats(res.data);
  }, [client]);

  const loadMessages = useCallback(async () => {
    const res = await client.request<{ messages: StoredMessage[] }>({ type: "get_messages" });
    if (res.success && res.data?.messages) dispatch({ type: "load", messages: res.data.messages });
  }, [client]);

  const sendPromptNow = useCallback(
    (text: string, attachments?: Attachment[], opts?: { streamingBehavior?: "steer" }) => {
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
      });

      client.send({
        type: "prompt",
        message,
        ...(images.length ? { images } : {}),
        ...(opts?.streamingBehavior ? { streamingBehavior: opts.streamingBehavior } : {}),
      });
    },
    [client],
  );

  sendPromptNowRef.current = sendPromptNow;

  const flushQueue = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;
    const [first, ...rest] = q;
    setQueue(rest);
    sendPromptNowRef.current(first.text, first.attachments);
  }, [setQueue]);

  const handleAgentEnd = useCallback(async () => {
    await Promise.all([refreshStats(), loadMessages()]);
    // A manual stop ends the run but leaves the queue paused as-is; only a
    // natural completion advances to the next queued message.
    if (stoppedRef.current) {
      stoppedRef.current = false;
      return;
    }
    flushQueue();
  }, [refreshStats, loadMessages, flushQueue]);

  handleAgentEndRef.current = () => {
    void handleAgentEnd();
  };

  const beginAttach = useCallback(() => {
    loading.current = true;
    buffer.current = [];
  }, []);

  const flushEvents = useCallback(
    (events: Event[]) => {
      for (const event of events) {
        if (event.type === "agent_start") stoppedRef.current = false;
        dispatch({ type: "event", event });
        if (event.type === "agent_end") handleAgentEndRef.current();
      }
    },
    [],
  );

  useEffect(() => {
    const offEvent = client.onEvent((event) => {
      if (loading.current) {
        buffer.current.push(event);
        return;
      }
      if (event.type === "agent_start") stoppedRef.current = false;
      dispatch({ type: "event", event });
      if (event.type === "agent_end") handleAgentEndRef.current();
    });
    const offStatus = client.onStatus((s) => {
      setStatus(s);
      if (s === "open") {
        beginAttach();
        void onAttachedRef.current();
      }
    });
    client.connect();
    return () => {
      offEvent();
      offStatus();
      client.close();
    };
  }, [client, beginAttach]);

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
      setPlanMode(planModeFromName(res.data.sessionName));
      setInitializing(false);
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
    beginAttach();

    const stateRes = await client.request<{
      model: Model | null;
      thinkingLevel: ThinkingLevel;
      isStreaming?: boolean;
      sessionName?: string;
    }>({ type: "get_state" });
    if (gen !== attachGen.current) return;

    await Promise.all([refreshStats(), applyPersona(storedPersona())]);
    if (gen !== attachGen.current) return;

    const msgRes = await client.request<{ messages: StoredMessage[] }>({ type: "get_messages" });
    if (gen !== attachGen.current) return;

    if (stateRes.success && stateRes.data) {
      setModel(stateRes.data.model);
      setThinkingLevel(stateRes.data.thinkingLevel);
      setSessionName(stateRes.data.sessionName);
      setPlanMode(planModeFromName(stateRes.data.sessionName));
      setInitializing(false);
    }
    if (msgRes.success && msgRes.data?.messages) {
      dispatch({ type: "load", messages: msgRes.data.messages });
    }

    const buffered = buffer.current;
    buffer.current = [];
    loading.current = false;
    flushEvents(buffered);

    if (stateRes.success && stateRes.data?.isStreaming) {
      dispatch({ type: "event", event: { type: "agent_start" } });
    }
  }, [beginAttach, flushEvents, applyPersona, refreshStats, client]);

  onAttachedRef.current = onAttached;

  const enqueue = useCallback(
    (text: string, attachments?: Attachment[]) => {
      setQueue((prev) => [...prev, { id: nextQueueId(), text, attachments }]);
    },
    [setQueue],
  );

  const removeQueued = useCallback(
    (id: string) => {
      setQueue((prev) => prev.filter((item) => item.id !== id));
    },
    [setQueue],
  );

  const editQueued = useCallback(
    (id: string, text: string) => {
      setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, text } : item)));
    },
    [setQueue],
  );

  const reorderQueued = useCallback(
    (from: number, to: number) => {
      setQueue((prev) => {
        if (from < 0 || from >= prev.length || to < 0 || to >= prev.length || from === to) return prev;
        const next = prev.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [setQueue],
  );

  const sendPrompt = useCallback(
    (text: string, attachments?: Attachment[]) => {
      if (state.streaming) {
        enqueue(text, attachments);
      } else {
        sendPromptNow(text, attachments);
      }
    },
    [state.streaming, sendPromptNow, enqueue],
  );

  const sendImmediate = useCallback(
    (text: string, attachments?: Attachment[]) => {
      sendPromptNow(text, attachments, { streamingBehavior: "steer" });
    },
    [sendPromptNow],
  );

  const togglePlanMode = useCallback(async () => {
    await client.request({ type: "run_command", name: "plan", args: "" });
    setPlanMode((prev) => (prev === "off" ? "on" : "off"));
  }, [client]);

  const abort = useCallback(() => {
    stoppedRef.current = true;
    client.send({ type: "abort" });
  }, [client]);

  const abortRemote = useCallback(
    async (id: string) => {
      if (id === client.session) {
        abort();
        return;
      }
      await fetch(`/api/sessions/abort?id=${encodeURIComponent(id)}`, { method: "POST" });
    },
    [client, abort],
  );

  const resetForSession = useCallback(() => {
    dispatch({ type: "reset" });
    setQueue([]);
    setModel(null);
    setThinkingLevel("medium");
    setSessionName(undefined);
    setStats(null);
    setAskMode(false);
    setPlanMode("off");
    setInitializing(true);
  }, [setQueue]);

  const newSession = useCallback(async () => {
    resetForSession();
    client.switchTo(undefined);
    setSessionId(client.session);
  }, [client, resetForSession]);

  const switchSession = useCallback(
    async (sessionPath: string, historyMode: "push" | "replace" | "none" = "push") => {
      if (sessionPath === client.session && historyMode === "none") return;
      resetForSession();
      beginAttach();
      client.switchTo(sessionPath, historyMode);
      setSessionId(client.session);
    },
    [client, resetForSession, beginAttach],
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

  return {
    sessionId,
    blocks: state.blocks,
    streaming: state.streaming,
    queue,
    status,
    initializing,
    model,
    thinkingLevel,
    stats,
    sessionName,
    sendPrompt,
    sendImmediate,
    removeQueued,
    editQueued,
    reorderQueued,
    abort,
    abortRemote,
    newSession,
    switchSession,
    renameSession,
    cycleThinking,
    getAvailableModels,
    pickModel,
    pickThinkingLevel,
    askMode,
    toggleAskMode,
    planMode,
    togglePlanMode,
    persona,
    setPersona,
  };
}

export type Session = ReturnType<typeof useSession>;
