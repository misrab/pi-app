import { WsRpcClient, type ConnectionStatus, type WsRpcResponse } from "make-pwa/ws-rpc";
import type { Command, Event, Response } from "./types";

export type { ConnectionStatus };

const SESSION_KEY = "pi-app:session-id";

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
    this.sessionId = sessionStorage.getItem(SESSION_KEY) ?? newId();
    sessionStorage.setItem(SESSION_KEY, this.sessionId);

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

  switchTo(sessionId?: string): void {
    this.sessionId = sessionId ?? newId();
    sessionStorage.setItem(SESSION_KEY, this.sessionId);
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

// Re-export for typing convenience in consumers.
export type { WsRpcResponse as RpcResponse };
