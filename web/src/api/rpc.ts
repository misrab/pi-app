import type { Command, Event, Incoming, Response } from "./types";

type EventHandler = (event: Event) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export type ConnectionStatus = "connecting" | "open" | "closed";

/**
 * RpcClient manages the WebSocket to the pi-app backend and speaks pi's JSON
 * protocol. Commands can be fire-and-forget or awaited via request() using the
 * protocol's `id` correlation. Events are pushed to subscribers.
 */
export class RpcClient {
  private ws: WebSocket | null = null;
  private url: string;
  private seq = 0;
  private pending = new Map<string, (res: Response) => void>();
  private eventHandlers = new Set<EventHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;

  constructor(url?: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.url = url ?? `${proto}://${location.host}/ws`;
  }

  connect() {
    this.shouldReconnect = true;
    this.open();
  }

  private open() {
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => this.setStatus("open");
    ws.onclose = () => {
      this.setStatus("closed");
      this.rejectAllPending();
      if (this.shouldReconnect) {
        this.reconnectTimer = window.setTimeout(() => this.open(), 1500);
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
    this.pending.clear();
  }
}
