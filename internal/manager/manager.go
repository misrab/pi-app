// Package manager keeps pi processes alive independently of any browser
// connection. One pi process maps to one session id; WebSockets attach to and
// detach from these processes without killing them. An idle reaper kills
// detached, idle processes after a TTL, and a concurrency cap bounds resource
// use.
package manager

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/misrab/pi-app/internal/pi"
)

// Status is a managed session's lifecycle state.
type Status string

const (
	StatusRunning Status = "running" // pi is mid-turn
	StatusIdle    Status = "idle"    // process alive, no active turn
	StatusStopped Status = "stopped" // process exited
)

const (
	ringSize       = 500              // events buffered per session for replay
	defaultMaxLive = 8                // max concurrent pi processes
	defaultIdleTTL = 30 * time.Minute // kill detached+idle after this
	reapInterval   = 1 * time.Minute
)

// SessionStatus is the manager's view of one session for the API.
type SessionStatus struct {
	ID       string `json:"id"`
	Status   Status `json:"status"`
	Attached int    `json:"attached"`
}

// ManagedSession owns one pi process plus its replay buffer and subscribers.
type ManagedSession struct {
	id   string
	proc *pi.Session

	mu       sync.Mutex
	ring     [][]byte // last ringSize events
	turnFrom int      // ring index of the current turn's agent_start (-1 if idle)
	status   Status
	attached int
	lastSeen time.Time
}

// Manager is the server-side pool of pi processes keyed by session id.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*ManagedSession
	opts     pi.Options
	maxLive  int
	idleTTL  time.Duration

	ctx    context.Context
	cancel context.CancelFunc
}

// New creates a Manager and starts its idle reaper.
func New(opts pi.Options) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{
		sessions: make(map[string]*ManagedSession),
		opts:     opts,
		maxLive:  defaultMaxLive,
		idleTTL:  defaultIdleTTL,
		ctx:      ctx,
		cancel:   cancel,
	}
	go m.reaper()
	return m
}

// Attach returns the managed session for id, spawning the pi process if it is
// not already running. When the session is mid-turn, the replay slice holds the
// events of the in-flight turn (since its agent_start) so a reattaching browser
// can render the partial response live; it is empty otherwise (committed history
// comes from get_messages). Caller must Detach when its WS closes.
func (m *Manager) Attach(id string, piArgs []string) (*ManagedSession, [][]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if ms, ok := m.sessions[id]; ok && ms.alive() {
		ms.mu.Lock()
		ms.attached++
		ms.lastSeen = time.Now()
		var replay [][]byte
		if ms.status == StatusRunning && ms.turnFrom >= 0 && ms.turnFrom <= len(ms.ring) {
			tail := ms.ring[ms.turnFrom:]
			replay = make([][]byte, len(tail))
			copy(replay, tail)
		}
		ms.mu.Unlock()
		return ms, replay, nil
	}

	if m.liveCount() >= m.maxLive {
		return nil, nil, fmt.Errorf("max concurrent sessions (%d) reached", m.maxLive)
	}

	opts := m.opts
	opts.Args = append(append([]string{}, m.opts.Args...), piArgs...)

	proc, err := pi.Start(m.ctx, opts)
	if err != nil {
		return nil, nil, fmt.Errorf("start pi: %w", err)
	}

	ms := &ManagedSession{
		id:       id,
		proc:     proc,
		status:   StatusIdle,
		turnFrom: -1,
		attached: 1,
		lastSeen: time.Now(),
	}
	m.sessions[id] = ms
	go ms.pump(proc)
	return ms, nil, nil
}

// Detach decrements the attached count. The process keeps running.
func (m *Manager) Detach(id string) {
	m.mu.Lock()
	ms := m.sessions[id]
	m.mu.Unlock()
	if ms == nil {
		return
	}
	ms.mu.Lock()
	if ms.attached > 0 {
		ms.attached--
	}
	ms.lastSeen = time.Now()
	ms.mu.Unlock()
}

// Stop kills the pi process for id. The session file persists on disk.
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	ms := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if ms == nil {
		return fmt.Errorf("no such session: %s", id)
	}
	return ms.proc.Close()
}

// List returns the status of every managed session.
func (m *Manager) List() []SessionStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SessionStatus, 0, len(m.sessions))
	for id, ms := range m.sessions {
		ms.mu.Lock()
		out = append(out, SessionStatus{ID: id, Status: ms.status, Attached: ms.attached})
		ms.mu.Unlock()
	}
	return out
}

// Close stops the reaper and kills all processes.
func (m *Manager) Close() {
	m.cancel()
	m.mu.Lock()
	for id, ms := range m.sessions {
		_ = ms.proc.Close()
		delete(m.sessions, id)
	}
	m.mu.Unlock()
}

// Send forwards a command line to the session's pi process.
func (ms *ManagedSession) Send(cmd []byte) error { return ms.proc.Send(cmd) }

// Subscribe proxies to the underlying process fan-out.
func (ms *ManagedSession) Subscribe() (<-chan []byte, func()) { return ms.proc.Subscribe() }

func (ms *ManagedSession) alive() bool {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	return ms.status != StatusStopped
}

// pump consumes the process event stream to maintain the replay ring and derive
// status (agent_start -> running, agent_end -> idle). It records the ring index
// where the current turn began (turnFrom) so Attach can replay just the in-flight
// turn. Ends when pi exits.
func (ms *ManagedSession) pump(proc *pi.Session) {
	ch, _ := proc.Subscribe()
	for line := range ch {
		ms.mu.Lock()
		ms.ring = append(ms.ring, line)
		if over := len(ms.ring) - ringSize; over > 0 {
			ms.ring = ms.ring[over:]
			// Shift turnFrom to track its event after trimming (clamp at 0).
			if ms.turnFrom >= 0 {
				if ms.turnFrom -= over; ms.turnFrom < 0 {
					ms.turnFrom = 0
				}
			}
		}
		switch eventType(line) {
		case "agent_start":
			ms.status = StatusRunning
			ms.turnFrom = len(ms.ring) - 1 // this agent_start's index
		case "agent_end":
			ms.status = StatusIdle
			ms.turnFrom = -1
			ms.lastSeen = time.Now()
		}
		ms.mu.Unlock()
	}
	ms.mu.Lock()
	ms.status = StatusStopped
	ms.mu.Unlock()
}

// reaper periodically kills detached, idle sessions past the TTL.
func (m *Manager) reaper() {
	t := time.NewTicker(reapInterval)
	defer t.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-t.C:
			m.reapOnce()
		}
	}
}

func (m *Manager) reapOnce() {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, ms := range m.sessions {
		ms.mu.Lock()
		dead := ms.status == StatusStopped
		idleExpired := ms.attached == 0 && ms.status == StatusIdle && now.Sub(ms.lastSeen) > m.idleTTL
		ms.mu.Unlock()
		if dead || idleExpired {
			_ = ms.proc.Close()
			delete(m.sessions, id)
		}
	}
}

// liveCount counts non-stopped sessions. Caller holds m.mu.
func (m *Manager) liveCount() int {
	n := 0
	for _, ms := range m.sessions {
		if ms.alive() {
			n++
		}
	}
	return n
}

// eventType extracts the "type" field from a pi event line.
func eventType(line []byte) string {
	var e struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(line, &e) != nil {
		return ""
	}
	return e.Type
}
