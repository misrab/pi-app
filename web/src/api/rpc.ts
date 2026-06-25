import type { Command, Event, Incoming, Response } from "./types";

type EventHandler = (event: Event) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export type ConnectionStatus = "connecting" | "open" | "closed";

// Per-tab session id — persisted in sessionStorage so a page reload or
// reconnect re-attaches to the same server-side session.
const SESSION_KEY = "pi-app:session-id";
const RECONNECT_MIN_MS = 1500;
const RECONNECT_MAX_MS = 30000;

/**
 * RpcClient manages the WebSocket to the pi-app backend.
 *
 * Reconnection strategy:
 *  - Exponential backoff (1.5s → 30s) on unexpected close.
 *  - Immediate reconnect (backoff reset) on visibilitychange → visible and on
 *    the network "online" event. This is the key fix for mobile: when the OS
 *    backgrounds the PWA, JS freezes and onclose may never fire; when the user
 *    returns to the app visibilitychange fires immediately and we reconnect.
 */
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
    // Reconnect immediately when the page becomes visible again (foreground)
    // or the network comes back. Both are critical on mobile where JS freezes
    // during backgrounding and onclose may never fire.
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("online", this.onOnline);
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

  close() {
    this.shouldReconnect = false;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("online", this.onOnline);
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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

  // ── Visibility / network ─────────────────────────────────────────────────

  private onVisibilityChange = () => {
    if (document.visibilityState === "visible") this.checkAndReconnect();
  };

  private onOnline = () => {
    this.checkAndReconnect();
  };

  /**
   * If the socket is not open, cancel any pending backoff timer and reconnect
   * immediately. Called on foreground and network-restore events so the user
   * never waits up to 30s for the backoff to fire.
   */
  private checkAndReconnect() {
    if (!this.shouldReconnect) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.open();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

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
        const delay = Math.min(RECONNECT_MIN_MS * 2 ** this.reconnectAttempts++, RECONNECT_MAX_MS);
        this.reconnectTimer = window.setTimeout(() => this.open(), delay);
      }
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => this.onMessage(e.data);
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
    for (const resolve of this.pending.values()) {
      resolve({ type: "response", command: "_disconnect", success: false, error: "disconnected" } as Response);
    }
    this.pending.clear();
  }
}

function newId(): string {
  return crypto.randomUUID();
}
