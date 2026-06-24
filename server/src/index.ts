// pi-app server: one Node process hosting all chat sessions as in-memory
// AgentSessions (pi SDK), bridged to the browser over WebSocket. Also serves
// the built React frontend and a small JSON API.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { resolveConfig, installPackages, startConfigPoll } from "./config.js";
import { Manager } from "./manager.js";
import { handleCommand } from "./rpc.js";
import { listSessions } from "./sessions.js";

const env = (k: string, d = "") => (process.env[k]?.trim() ? process.env[k]!.trim() : d);
const num = (k: string, d: number) => {
  const v = Number(env(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};

const PORT = num("PORT", 8080);
const CWD = env("PI_CWD", process.cwd());
const WEB_DIR = env("WEB_DIR", join(import.meta.dirname, "..", "public"));

// Provision the agent config dir (clone/seed repo, overlay auth, install
// packages), then expose it to the SDK + SessionManager via the env var.
const cfg = {
  repo: env("PI_CONFIG_REPO"),
  seed: env("PI_CONFIG_SEED"),
  dir: env("PI_CONFIG_DIR", "/data/pi-config"),
  subdir: env("PI_CONFIG_SUBDIR"),
  sshKey: env("PI_SSH_KEY"),
  authFile: env("PI_AUTH_FILE"),
  piBin: env("PI_BIN", "pi"),
};
const agentDir = resolveConfig(cfg);
if (agentDir) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
}

mkdirSync(CWD, { recursive: true }); // agent working dir + session-storage slug

const manager = new Manager({
  cwd: CWD,
  agentDir,
  maxLive: num("PI_MAX_SESSIONS", 100),
  idleTTLms: num("PI_IDLE_TTL_MS", 30 * 60_000),
});

// --- HTTP -------------------------------------------------------------------

const server = createServer((req, res) => void handleHttp(req, res));

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health") return json(res, { healthy: true });

  if (url.pathname === "/api/sessions" && req.method === "GET") {
    return json(res, await listSessions(CWD, manager));
  }
  if (url.pathname === "/api/sessions/stop" && req.method === "POST") {
    const id = url.searchParams.get("id") ?? "";
    const ok = await manager.stop(id);
    res.writeHead(ok ? 204 : 404).end();
    return;
  }
  if (url.pathname === "/api/settings" && req.method === "GET") {
    return json(res, readEnabledModels(agentDir));
  }

  return serveStatic(url.pathname, res);
}

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readEnabledModels(dir: string): { enabledModels?: string[] } {
  try {
    const path = join(dir || `${process.env.HOME}/.pi/agent`, "settings.json");
    const s = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(s.enabledModels) ? { enabledModels: s.enabledModels } : {};
  } catch {
    return {};
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  // Resolve within WEB_DIR; fall back to index.html for SPA routes.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(WEB_DIR, rel);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(WEB_DIR, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  }
}

// --- WebSocket --------------------------------------------------------------

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const id = url.searchParams.get("session");
  if (!id) {
    ws.close(1008, "missing session id");
    return;
  }

  const send = (obj: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const sendRaw = (line: string) => {
    if (ws.readyState === ws.OPEN) ws.send(line);
  };

  // Listeners are attached synchronously; commands that arrive before the
  // session is ready (attach is async) are queued, then flushed in order.
  let session: any;
  const queue: string[] = [];

  const dispatch = (raw: string) => {
    let command: any;
    try {
      command = JSON.parse(raw);
    } catch {
      return;
    }
    void handleCommand(session, command, send)
      .then((response) => response && send(response))
      .catch((e) =>
        send({ type: "response", id: command?.id, command: command?.type, success: false, error: msg(e) }),
      );
  };

  let unsubscribe = () => {};
  ws.on("message", (data) => {
    const raw = data.toString();
    if (session) dispatch(raw);
    else queue.push(raw);
  });
  ws.on("close", () => {
    unsubscribe();
    manager.detach(id);
  });

  manager
    .attach(id)
    .then(({ ms }) => {
      session = ms.session;
      // No event replay: the client rebuilds committed history from get_messages
      // and reconciles to the authoritative state on agent_end. Replaying the
      // in-flight turn here would double-count it against that snapshot.
      unsubscribe = ms.subscribe(sendRaw);
      for (const raw of queue) dispatch(raw);
      queue.length = 0;
    })
    .catch((e) => {
      send({ type: "response", command: "attach", success: false, error: msg(e) });
      ws.close(1011, "attach failed");
    });
});

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- lifecycle --------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`pi-app listening on :${PORT} (cwd ${CWD}, agentDir ${agentDir || "default"})`);
  // Install declared packages + start the config poll in the background so a
  // slow `pi install` never delays the server (and /health) from coming up.
  if (agentDir) {
    void installPackages(agentDir, cfg.piBin);
    startConfigPoll(cfg, num("PI_CONFIG_POLL_MS", 120_000));
  }
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void manager.closeAll().finally(() => process.exit(0));
  });
}
