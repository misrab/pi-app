import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { RpcClient, type ConnectionStatus } from "../api/rpc";
import type { Event, Model, SessionStats, ThinkingLevel } from "../api/types";

// A Block is one renderable unit in the transcript.
export type Block =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "thinking"; text: string }
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
  | { type: "user"; text: string }
  | { type: "event"; event: Event }
  | { type: "reset" };

let uid = 0;
const nextId = () => `b${++uid}`;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { blocks: [], streaming: false };

    case "user":
      return { ...state, blocks: [...state.blocks, { id: nextId(), kind: "user", text: action.text }] };

    case "event":
      return handleEvent(state, action.event);
  }
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
      return updateTool(state, event.toolCallId, (b) => ({
        ...b,
        result: text,
        isError: event.isError,
        done: true,
      }));
    }

    default:
      return state;
  }
}

function updateTool(state: State, toolId: string, fn: (b: Extract<Block, { kind: "tool" }>) => Block): State {
  const blocks = state.blocks.map((b) => (b.kind === "tool" && b.toolId === toolId ? fn(b) : b));
  return { ...state, blocks };
}

function extractText(content?: { type: string; text?: string }[]): string {
  if (!content) return "";
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
}

export function useSession() {
  const clientRef = useRef<RpcClient | null>(null);
  if (!clientRef.current) clientRef.current = new RpcClient();
  const client = clientRef.current;

  const [state, dispatch] = useReducer(reducer, { blocks: [], streaming: false });
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [model, setModel] = useState<Model | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [sessionName, setSessionName] = useState<string | undefined>();

  // Wire up the client once.
  useEffect(() => {
    const offEvent = client.onEvent((event) => {
      dispatch({ type: "event", event });
      if (event.type === "agent_end") void refreshStats();
    });
    const offStatus = client.onStatus((s) => {
      setStatus(s);
      if (s === "open") void refreshState();
    });
    client.connect();
    return () => {
      offEvent();
      offStatus();
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    }
  }, [client]);

  const refreshStats = useCallback(async () => {
    const res = await client.request<SessionStats>({ type: "get_session_stats" });
    if (res.success && res.data) setStats(res.data);
  }, [client]);

  const sendPrompt = useCallback(
    (text: string) => {
      dispatch({ type: "user", text });
      client.send({ type: "prompt", message: text });
    },
    [client],
  );

  const abort = useCallback(() => client.send({ type: "abort" }), [client]);

  const newSession = useCallback(async () => {
    await client.request({ type: "new_session" });
    dispatch({ type: "reset" });
    await refreshState();
    setStats(null);
  }, [client, refreshState]);

  return {
    client,
    blocks: state.blocks,
    streaming: state.streaming,
    status,
    model,
    thinkingLevel,
    stats,
    sessionName,
    sendPrompt,
    abort,
    newSession,
    refreshState,
    refreshStats,
  };
}

export type Session = ReturnType<typeof useSession>;
