// Manager hosts every chat session as an in-memory AgentSession inside this one
// Node process (no per-session subprocess). WebSockets attach/detach to a
// session by id; the pi process-equivalent (the AgentSession) keeps running
// when no socket is attached, and an idle reaper disposes detached sessions.
import {
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";

export type Status = "running" | "idle";

const RING_SIZE = 500; // events buffered per session for in-flight-turn replay
const REAP_INTERVAL_MS = 60_000;

export interface ManagerOptions {
  cwd: string; // fixed working dir for the agent; also scopes session storage
  agentDir: string; // "" => pi default (~/.pi/agent). Set via PI_CODING_AGENT_DIR.
  maxLive: number; // safety cap on concurrent live sessions
  idleTTLms: number; // dispose detached + idle sessions after this
}

type Listener = (line: string) => void;

class ManagedSession {
  readonly id: string;
  session: any;
  private subscribers = new Set<Listener>();
  private ring: string[] = [];
  private turnFrom = -1; // ring index of the current turn's agent_start (-1 = idle)
  status: Status = "idle";
  attached = 0;
  lastSeen = Date.now();
  private unsubscribe: () => void = () => {};

  constructor(id: string, session: any) {
    this.id = id;
    this.session = session;
    this.unsubscribe = session.subscribe((event: any) => this.onEvent(event));
  }

  private onEvent(event: any): void {
    const line = JSON.stringify(event);
    this.ring.push(line);
    if (this.ring.length > RING_SIZE) {
      const over = this.ring.length - RING_SIZE;
      this.ring = this.ring.slice(over);
      if (this.turnFrom >= 0) this.turnFrom = Math.max(0, this.turnFrom - over);
    }
    if (event?.type === "agent_start") {
      this.status = "running";
      this.turnFrom = this.ring.length - 1;
    } else if (event?.type === "agent_end") {
      this.status = "idle";
      this.turnFrom = -1;
      this.lastSeen = Date.now();
    }
    for (const fn of this.subscribers) fn(line);
  }

  /** Replay slice for a reattaching socket: the in-flight turn, or nothing. */
  replay(): string[] {
    if (this.status === "running" && this.turnFrom >= 0 && this.turnFrom <= this.ring.length) {
      return this.ring.slice(this.turnFrom);
    }
    return [];
  }

  subscribe(fn: Listener): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  async dispose(): Promise<void> {
    this.unsubscribe();
    this.subscribers.clear();
    try {
      await this.session.abort();
    } catch {
      /* ignore */
    }
    this.session.dispose();
  }
}

export class Manager {
  private sessions = new Map<string, ManagedSession>();
  private creating = new Map<string, Promise<ManagedSession>>();
  private authStorage: any;
  private modelRegistry: any;

  constructor(private opts: ManagerOptions) {
    const authPath = opts.agentDir ? `${opts.agentDir}/auth.json` : undefined;
    const modelsPath = opts.agentDir ? `${opts.agentDir}/models.json` : undefined;
    this.authStorage = AuthStorage.create(authPath);
    this.modelRegistry = ModelRegistry.create(this.authStorage, modelsPath);
    setInterval(() => void this.reap(), REAP_INTERVAL_MS).unref();
  }

  /** Attach to (or create) the session for id. Caller must detach() on close. */
  async attach(id: string): Promise<{ ms: ManagedSession; replay: string[] }> {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.attached++;
      existing.lastSeen = Date.now();
      return { ms: existing, replay: existing.replay() };
    }
    if (this.liveCount() >= this.opts.maxLive) {
      throw new Error(`max concurrent sessions (${this.opts.maxLive}) reached`);
    }
    const ms = await this.getOrCreate(id);
    ms.attached++;
    ms.lastSeen = Date.now();
    return { ms, replay: ms.replay() };
  }

  detach(id: string): void {
    const ms = this.sessions.get(id);
    if (!ms) return;
    if (ms.attached > 0) ms.attached--;
    ms.lastSeen = Date.now();
  }

  async stop(id: string): Promise<boolean> {
    const ms = this.sessions.get(id);
    if (!ms) return false;
    this.sessions.delete(id);
    await ms.dispose();
    return true;
  }

  list(): { id: string; status: Status; attached: number }[] {
    return [...this.sessions.values()].map((ms) => ({
      id: ms.id,
      status: ms.status,
      attached: ms.attached,
    }));
  }

  async closeAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((ms) => ms.dispose()));
  }

  // --- internals ------------------------------------------------------------

  private liveCount(): number {
    return this.sessions.size;
  }

  private getOrCreate(id: string): Promise<ManagedSession> {
    const inflight = this.creating.get(id);
    if (inflight) return inflight;
    const existing = this.sessions.get(id);
    if (existing) return Promise.resolve(existing);

    const p = this.create(id).finally(() => this.creating.delete(id));
    this.creating.set(id, p);
    return p;
  }

  private async create(id: string): Promise<ManagedSession> {
    const { cwd, agentDir } = this.opts;

    // Resolve a SessionManager for this id: open the existing file or create
    // one with the exact id (the pi CLI's `--session-id` semantics). Storage
    // location is fixed by PI_CODING_AGENT_DIR + cwd, so sessionDir is omitted.
    const list = await SessionManager.list(cwd);
    const match = list.find((s: any) => s.id === id);
    const sessionManager = match
      ? SessionManager.open(match.path)
      : SessionManager.create(cwd, undefined, { id });

    const settingsManager = agentDir
      ? SettingsManager.create(cwd, agentDir)
      : SettingsManager.create(cwd);

    const { session } = await createAgentSession({
      cwd,
      ...(agentDir ? { agentDir } : {}),
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      settingsManager,
      sessionManager,
    });

    await bindExtensions(session);

    const ms = new ManagedSession(id, session);
    this.sessions.set(id, ms);
    return ms;
  }

  private async reap(): Promise<void> {
    const now = Date.now();
    for (const [id, ms] of this.sessions) {
      const idleExpired =
        ms.attached === 0 && ms.status === "idle" && now - ms.lastSeen > this.opts.idleTTLms;
      if (idleExpired) {
        this.sessions.delete(id);
        await ms.dispose().catch(() => {});
      }
    }
  }
}

// Bind extensions for a non-interactive host (mirrors print-mode). No UI
// context: dialog/notify UI is a no-op, which matches the previous behaviour
// where the browser ignored extension UI requests.
async function bindExtensions(session: any): Promise<void> {
  await session.bindExtensions({
    mode: "print",
    commandContextActions: {
      waitForIdle: () => session.agent.waitForIdle(),
      reload: async () => session.reload(),
      navigateTree: async (targetId: string, options: any) => {
        const r = await session.navigateTree(targetId, options ?? {});
        return { cancelled: r.cancelled };
      },
      // Session-replacement actions are driven by the browser reconnecting the
      // WebSocket to a different id, not by extensions, so these are no-ops.
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      switchSession: async () => ({ cancelled: true }),
    },
    onError: (e: any) => console.error(`extension error (${e.extensionPath}): ${e.error}`),
  });
}
