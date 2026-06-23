// Package web serves the chat UI and bridges browser WebSocket connections to
// a per-connection `pi --mode rpc` subprocess. The browser speaks pi's JSON
// protocol directly; this server is essentially a transparent pipe.
package web

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/coder/websocket"
	"github.com/misrab/pi-app/internal/manager"
	"github.com/misrab/pi-app/internal/pi"
	"github.com/misrab/pi-app/internal/sessions"
)

// Server serves the UI and WebSocket bridge.
type Server struct {
	piOpts     pi.Options
	sessionDir string
	mgr        *manager.Manager
}

// New creates a web server that spawns pi sessions with the given options.
// sessionDir is where pi stores session files (for the resume UI).
func New(piOpts pi.Options, sessionDir string) *Server {
	return &Server{piOpts: piOpts, sessionDir: sessionDir, mgr: manager.New(piOpts)}
}

// Handler returns the HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/api/sessions", s.handleSessions)
	mux.HandleFunc("/api/sessions/stop", s.handleStop)
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"healthy":true}`))
	})
	mux.Handle("/", s.spaHandler())
	return mux
}

// handleSessions lists saved sessions for the resume UI, annotated with the
// live status of any managed (running) processes.
func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	list, err := sessions.List(s.sessionDir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	live := map[string]manager.SessionStatus{}
	for _, st := range s.mgr.List() {
		live[st.ID] = st
	}
	type annotated struct {
		sessions.Info
		Status   string `json:"status"`
		Attached int    `json:"attached"`
	}
	out := make([]annotated, 0, len(list))
	for _, info := range list {
		a := annotated{Info: info, Status: "stopped"}
		if st, ok := live[info.Path]; ok {
			a.Status = string(st.Status)
			a.Attached = st.Attached
		}
		out = append(out, a)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// handleStop kills the pi process for a session id (?id=<sessionPath>). The
// session file persists on disk for cold resume.
func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	if err := s.mgr.Stop(id); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleSettings reads settings.json from the pi config dir and returns the
// fields the UI needs (currently just enabledModels for the model picker).
func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Determine settings.json path. ConfigDir is empty when pi uses its default
	// (~/.pi/agent), so fall back to the well-known default location.
	dir := s.piOpts.ConfigDir
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".pi", "agent")
	}
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		// No settings file — return empty object so the UI shows all models.
		w.Write([]byte(`{}`))
		return
	}
	// Forward only the fields the UI cares about.
	var all map[string]json.RawMessage
	if err := json.Unmarshal(data, &all); err != nil {
		w.Write([]byte(`{}`))
		return
	}
	out := map[string]json.RawMessage{}
	if v, ok := all["enabledModels"]; ok {
		out["enabledModels"] = v
	}
	_ = json.NewEncoder(w).Encode(out)
}

// spaHandler serves the embedded Vite build, falling back to index.html for
// client-side routes.
func (s *Server) spaHandler() http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(sub, trimLeadingSlash(r.URL.Path)); err != nil {
			// not a real file -> serve index.html (SPA fallback)
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}

// randID returns a short random hex string for transient session keys.
func randID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func trimLeadingSlash(p string) string {
	if p == "/" {
		return "."
	}
	if len(p) > 0 && p[0] == '/' {
		return p[1:]
	}
	return p
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// same-origin in browser; behind tailscale anyway
		InsecureSkipVerify: true,
	})
	if err != nil {
		slog.Error("ws accept failed", "err", err)
		return
	}
	defer conn.CloseNow()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Attach to (or spawn) the managed session for this id. The id is the pi
	// session file path; empty means a fresh session, which gets a unique
	// transient key so concurrent "new" tabs don't collide on the same process.
	id := r.URL.Query().Get("session")
	var piArgs []string
	if id != "" {
		piArgs = []string{"--session", id}
	} else {
		id = "new:" + randID()
	}
	// Committed history comes from get_messages on the client. When the session
	// is mid-turn, replay holds the in-flight turn's events (since agent_start) so
	// the browser can render the partial response live. The client buffers all
	// events until its get_messages load completes, then flushes in arrival order,
	// so replay applied on top of committed history reconstructs the partial.
	ms, replay, err := s.mgr.Attach(id, piArgs)
	if err != nil {
		slog.Error("failed to attach session", "err", err)
		conn.Close(websocket.StatusInternalError, "failed to attach session")
		return
	}
	defer s.mgr.Detach(id)

	events, unsub := ms.Subscribe()
	defer unsub()

	for _, ev := range replay {
		if err := conn.Write(ctx, websocket.MessageText, ev); err != nil {
			return
		}
	}

	// pi events -> browser (process keeps running after WS closes)
	go func() {
		for ev := range events {
			if err := conn.Write(ctx, websocket.MessageText, ev); err != nil {
				cancel()
				return
			}
		}
		cancel()
	}()

	// browser commands -> pi
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if err := ms.Send(data); err != nil {
			slog.Error("failed to send to pi", "err", err)
			return
		}
	}
}
