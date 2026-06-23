# Design: Background Sessions

## Goal

Let agentic tasks keep running when the user switches sessions or closes the
browser tab. Reconnecting reattaches to the live process and replays what
happened while away. Add UI to see all sessions, their status, and stop them.

## Current architecture (and why it blocks this)

```
browser WS connect ──► spawn 1 `pi --mode rpc` process
browser WS close   ──► defer session.Close() kills the process
switch_session     ──► RPC command pi runs INSIDE that one process
```

Two structural facts:

1. **One process per WebSocket.** `handleWS` in `internal/web/server.go` calls
   `pi.Start` per connection and `defer session.Close()` kills it on disconnect.
2. **One active conversation per process.** Switching sessions is the pi RPC
   command `switch_session`, which swaps the loaded `.jsonl` *within the single
   process*. pi never runs two conversations at once in one process.

So "the other session keeps running in the background" is **impossible today** —
there is only ever one process, running one conversation, tied to one WS.

## The decision: process pool, one pi process per session

To get true background concurrency we move from *one process per connection* to
**one long-lived process per session**, managed server-side and decoupled from
any WebSocket.

```
                    ┌─────────────── SessionManager (server) ───────────────┐
browser WS ◄──attach──►│  sessionID → ManagedSession{ proc, ringBuffer, subs }│
                    │  sessionID → ManagedSession{ proc, ringBuffer, subs }│  (running, detached)
                    │  sessionID → ManagedSession{ proc, ringBuffer, subs }│  (running, attached)
                    └───────────────────────────────────────────────────────┘
```

- A `ManagedSession` owns one `pi --mode rpc` process bound to one session file
  (via pi's `--session <path>` / `--name`), plus a ring buffer of recent events
  and a set of subscriber WebSockets.
- WS connect **attaches** to a session (by id) and replays the ring buffer.
- WS close **detaches** only — the process keeps running.
- A process is killed only by explicit stop or the idle reaper.

This keeps the "browser speaks pi's JSON protocol directly" property: the WS is
still a transparent pipe, just to a shared, persistent process instead of a
per-connection one.

## Backend changes

### 1. `internal/pi/session.go`
- Add **fan-out**: `Subscribe() (<-chan []byte, func())` so multiple WS can read
  one event stream. Today `Events()` is a single consumer.
- Keep `Send`, `Close` as-is.

### 2. New `internal/manager/manager.go`
```go
type ManagedSession struct {
    ID        string
    proc      *pi.Session
    ring      *RingBuffer   // last N events for replay
    subs      map[*subscriber]struct{}
    status    Status        // running | idle | stopped
    lastSeen  time.Time     // last activity (for reaper)
    attached  int           // live WS count
}

type Manager struct {
    mu       sync.Mutex
    sessions map[string]*ManagedSession
    opts     pi.Options
    maxLive  int           // cap concurrent processes
    idleTTL  time.Duration // kill detached+idle after this
}

func (m *Manager) Attach(id string) (*ManagedSession, error) // spawn or reuse
func (m *Manager) Detach(id string, s *subscriber)
func (m *Manager) Stop(id string) error                      // explicit kill
func (m *Manager) List() []SessionStatus
func (m *Manager) reaper()                                   // background goroutine
```

Status derivation:
- `running`  — pi is mid-turn (saw `agent_start`, no `agent_end` yet)
- `idle`     — process alive, no active turn
- `stopped`  — process exited (detected via `Events()` channel close)

### 3. `internal/web/server.go`
- `handleWS`: parse `?session=<id>` (or `new`), call `manager.Attach`, replay
  ring buffer, subscribe. On WS close → `manager.Detach` (NO kill).
- `GET  /api/sessions` — add `status` + `attached` fields to each entry.
- `POST /api/sessions/{id}/stop` — `manager.Stop`.
- Optional: `POST /api/sessions` to pre-spawn a session without a browser.

### 4. Resource safety (ship with v1, not later)
- **Idle reaper** goroutine: every minute, kill sessions where `attached == 0`,
  `status == idle`, and `now - lastSeen > idleTTL` (default 30m).
- **Max concurrent** processes (`maxLive`, default e.g. 8); reject/queue beyond.
- **Ring buffer cap**: ~500 events or ~1MB per session; oldest dropped.
- On process exit, mark `stopped`, keep in map briefly so UI can show it, then
  evict.

## Frontend changes

### `api/rpc.ts`
- `RpcClient` takes a `sessionId`; connect to `/ws?session=<id>`.
- On reconnect, reattach to the same id (don't spawn new).

### Session list UI (sidebar or sheet)
Extend the existing `SessionMenu` + `/api/sessions`:
- status badge per row: ● running / ○ idle / ✕ stopped
- "live now" indicator if `attached > 0` elsewhere
- **Stop** button → `POST /api/sessions/{id}/stop`
- click row → switch the browser to that session (`?session=<id>`), replay state

### `useSession.ts`
- `switchSession` becomes "reattach WS to a different session id" rather than
  the in-process `switch_session` RPC. (Or keep RPC switch for the *attached*
  process and use attach for *background* ones — decide in Phase 2.)
- Stop button wired to the manager endpoint; on stop, mark UI as stopped.

## Phasing

**Phase 1 — Persistence (core value). ✅ DONE**
- `pi.Session` fan-out (`Subscribe`), multi-WS per process
- `internal/manager` process pool: Attach/Detach/Stop/List + idle reaper (30m)
  + max-live cap (8) + 500-event ring buffer
- `/ws?session=<id>` attaches/detaches (no kill on disconnect)
- `GET /api/sessions` annotated with `status`+`attached`; `POST /api/sessions/stop`
- Frontend: `RpcClient.switchTo`, unify-on-attach `switchSession`/`newSession`,
  transcript via `get_messages` on attach

**Phase 2 — Concurrency + UI. ✅ DONE**
- Session list shows live status dots (running/idle/stopped) + stop buttons
- Switching to a session leaves the previous process running in the background
- Ring-buffer replay deferred to Phase 3 (live re-attach to a streaming session)

**Phase 3 — Live re-attach. ✅ DONE**
- Manager records `turnFrom` (ring index of the current turn's `agent_start`,
  trim-adjusted); Attach returns just the in-flight turn's events when running.
- `server.go` streams the replay tail on attach before live subscription.
- Client buffers all events during the get_messages load window, then flushes
  in arrival order — replay applied over committed history rebuilds the partial.
- Result: reattaching to a streaming session renders it token-by-token live.

**Phase 4 — Polish (future).**
Pre-spawn sessions, per-session resource display, notifications when a
background task finishes (`agent_end` while detached).

## Locked decisions
- **Unify on attach.** No in-process `switch_session`; switching = detach +
  attach to target id. One mental model.
- **Two stop controls, kept distinct:**
  - in-chat ■ button (when running) = `abort` the current turn, process lives.
  - session-list Stop = kill the pi process. Period. File persists for cold resume.

## Open questions
- Multi-user: today it's single-user behind Tailscale. If that changes, sessions
  need ownership/auth before this is safe.
- Persisting the manager across server restarts: processes die on redeploy.
  Acceptable for v1 (sessions resume from disk, just not mid-turn).

## Answer to "can the user always press stop?"
Yes — two distinct controls:
- **Abort** (existing `abort` RPC): stops the current *turn*, session stays alive.
- **Stop** (new): kills the *process*. Session file persists; can be resumed cold.
