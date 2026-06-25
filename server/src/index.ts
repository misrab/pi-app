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
import { msg } from "./util.js";

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

// How often to send a WebSocket protocol-level ping to each client.
// The browser responds automatically with a pong. If no pong arrives within
// this interval the connection is considered dead and terminated, which fires
// onclose on the client and triggers its reconnect logic.
const WS_PING_INTERVAL_MS = 30_000;

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  if (manager.isDraining()) {
    ws.close(1012, "server draining");
    return;
  }

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

  // Keepalive: protocol-level ping every 30s; terminate if no pong (common when
  // a backgrounded PWA freezes JS). Browser responds with pong automatically.
  let isAlive = true;
  ws.on("pong", () => { isAlive = true; });
  const pingTimer = setInterval(() => {
    if (!isAlive) {
      ws.terminate(); // triggers onclose on both sides
      return;
    }
    isAlive = false;
    if (ws.readyState === ws.OPEN) ws.ping();
  }, WS_PING_INTERVAL_MS);

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
    clearInterval(pingTimer);
    unsubscribe();
    manager.detach(id);
  });

  manager
    .attach(id)
    .then(({ ms, replay }) => {
      session = ms.session;
      // Replay the in-flight turn so a reconnecting client sees live progress.
      // get_messages remains authoritative on agent_end (client reconciles then).
      for (const line of replay) sendRaw(line);
      unsubscribe = ms.subscribe(sendRaw);
      for (const raw of queue) dispatch(raw);
      queue.length = 0;
    })
    .catch((e) => {
      send({ type: "response", command: "attach", success: false, error: msg(e) });
      ws.close(1011, "attach failed");
    });
});

server.listen(PORT, () => {
  console.log(`pi-app listening on :${PORT} (cwd ${CWD}, agentDir ${agentDir || "default"})`);
  // Install declared packages + start the config poll in the background so a
  // slow `pi install` never delays the server (and /health) from coming up.
  if (agentDir) {
    void installPackages(agentDir, cfg.piBin);
    startConfigPoll(cfg, num("PI_CONFIG_POLL_MS", 120_000));
  }
});

// Slightly under tiberius stop_grace (150s) so we exit cleanly before SIGKILL.
const DRAIN_MS = num("PI_DRAIN_MS", 140_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void (async () => {
      console.log("draining: waiting for in-flight turns to finish…");
      manager.setDraining();
      wss.close();
      server.close();
      const idle = await manager.waitForIdle(DRAIN_MS);
      if (!idle) console.warn("drain timeout — exiting with turns still running");
      else console.log("drain complete");
      process.exit(0);
    })();
  });
}
