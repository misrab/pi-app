import { WsRpcClient, type ConnectionStatus } from "make-pwa/ws-rpc";
import type { Command, Event, Response } from "./types";

export type { ConnectionStatus };

const SESSION_KEY = "pi-app:session-id";
const SESSION_PATH = /^\/s\/([^/]+)$/;

export type SessionHistoryMode = "push" | "replace" | "none";

/** Read the session id from `/s/:id`, if present. */
export function sessionIdFromPath(): string | null {
  const m = location.pathname.match(SESSION_PATH);
  return m?.[1] ?? null;
}

function sessionPath(id: string): string {
  return `/s/${encodeURIComponent(id)}`;
}

function syncHistory(id: string, mode: SessionHistoryMode): void {
  const path = sessionPath(id);
  if (mode === "push") history.pushState({}, "", path);
  else if (mode === "replace") history.replaceState({}, "", path);
}

/**
 * Pi-app RPC client: session-scoped WebSocket to the backend.
 * Built on make-pwa/ws-rpc for reconnect/backoff; pi Command/Event types stay here.
 */
export class RpcClient {
  private sessionId: string;
  private base: string;
  private inner: WsRpcClient<Command, Event>;

  constructor(url?: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.base = url ?? `${proto}://${location.host}/ws`;
    const fromPath = sessionIdFromPath();
    this.sessionId = fromPath ?? sessionStorage.getItem(SESSION_KEY) ?? newId();
    // Tab-scoped fallback for first visit to `/`; URL is source of truth after sync.
    sessionStorage.setItem(SESSION_KEY, this.sessionId);
    if (!fromPath) syncHistory(this.sessionId, "replace");

    this.inner = new WsRpcClient<Command, Event>({
      getUrl: () => `${this.base}?session=${encodeURIComponent(this.sessionId)}`,
    });
  }

  get session(): string {
    return this.sessionId;
  }

  connect(): void {
    this.inner.connect();
  }

  switchTo(sessionId?: string, historyMode: SessionHistoryMode = "push"): void {
    this.sessionId = sessionId ?? newId();
    sessionStorage.setItem(SESSION_KEY, this.sessionId);
    syncHistory(this.sessionId, historyMode);
    this.inner.reconnect();
  }

  close(): void {
    this.inner.close();
  }

  send(cmd: Command): void {
    this.inner.send(cmd);
  }

  request<T = unknown>(cmd: Command, timeoutMs?: number): Promise<Response<T>> {
    return this.inner.request<T>(cmd, timeoutMs) as Promise<Response<T>>;
  }

  onEvent(handler: (event: Event) => void): () => void {
    return this.inner.onMessage(handler);
  }

  onStatus(handler: (status: ConnectionStatus) => void): () => void {
    return this.inner.onStatus(handler);
  }
}

function newId(): string {
  return crypto.randomUUID();
}
