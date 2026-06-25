import type { Command, Event, Incoming, Response } from "./types";

type EventHandler = (event: Event) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export type ConnectionStatus = "connecting" | "open" | "closed";

/**
 * RpcClient manages the WebSocket to the pi-app backend and speaks pi's JSON
 * protocol. Commands can be fire-and-forget or awaited via request() using the
 * protocol's `id` correlation. Events are pushed to subscribers.
 */
// Per-tab session id. The client owns a stable id so a reconnect/reload
// re-attaches to the same server-side session instead of spawning a new one.
const SESSION_KEY = "pi-app:session-id";
const RECONNECT_MIN_MS = 1500;
const RECONNECT_MAX_MS = 30000;

export class RpcClient {
  private ws: WebSocket | null = null;
  private base: string;
  private sessionId: string;
  private seq = 0;
  private pending = new Map<string, (res: Response) => void>();
  private eventHandlers = new Set<EventHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;

  constructor(url?: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.base = url ?? `${proto}://${location.host}/ws`;
    this.sessionId = sessionStorage.getItem(SESSION_KEY) ?? newId();
    sessionStorage.setItem(SESSION_KEY, this.sessionId);
  }

  /** Current session id. */
  get session(): string {
    return this.sessionId;
  }

  connect() {
    this.shouldReconnect = true;
    this.open();
  }

  /**
   * Re-attach to a different session id. Passing undefined starts a fresh
   * session (new id). The id is persisted so reconnects re-attach to it.
   */
  switchTo(sessionId?: string) {
    this.sessionId = sessionId ?? newId();
    sessionStorage.setItem(SESSION_KEY, this.sessionId);
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = null; // suppress auto-reconnect of the stale socket
      old.close();
    }
    this.open();
  }

  private wsUrl(): string {
    return `${this.base}?session=${encodeURIComponent(this.sessionId)}`;
  }

  private open() {
    this.setStatus("connecting");
    const ws = new WebSocket(this.wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("open");
    };
    ws.onclose = () => {
      this.setStatus("closed");
      this.rejectAllPending();
      if (this.shouldReconnect) {
        // Exponential backoff so a persistent failure doesn't hammer the server.
        const delay = Math.min(RECONNECT_MIN_MS * 2 ** this.reconnectAttempts++, RECONNECT_MAX_MS);
        this.reconnectTimer = window.setTimeout(() => this.open(), delay);
      }
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => this.onMessage(e.data);
  }

  close() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  /** Fire-and-forget command. */
  send(cmd: Command) {
    this.ws?.send(JSON.stringify(cmd));
  }

  /** Send a command and await its correlated response. */
  request<T = unknown>(cmd: Command, timeoutMs = 15000): Promise<Response<T>> {
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${cmd.type}`));
      }, timeoutMs);

      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res as Response<T>);
      });
      this.ws?.send(JSON.stringify({ ...cmd, id }));
    });
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private onMessage(raw: string) {
    let msg: Incoming;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "response") {
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg);
        this.pending.delete(msg.id);
      }
      return;
    }

    for (const h of this.eventHandlers) h(msg as Event);
  }

  private setStatus(status: ConnectionStatus) {
    for (const h of this.statusHandlers) h(status);
  }

  private rejectAllPending() {
    // Resolve every pending request immediately with a failure response so their
    // per-request timeouts get cleared and callers can react without waiting 15s.
    for (const resolve of this.pending.values()) {
      resolve({ type: "response", command: "_disconnect", success: false, error: "disconnected" } as Response);
    }
    this.pending.clear();
  }
}

/** Generate a stable session id (browser secure context provides randomUUID). */
function newId(): string {
  return crypto.randomUUID();
}
