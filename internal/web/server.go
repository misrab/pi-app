// Package web serves the chat UI and bridges browser WebSocket connections to
// a per-connection `pi --mode rpc` subprocess. The browser speaks pi's JSON
// protocol directly; this server is essentially a transparent pipe.
package web

import (
	"context"
	"embed"
	"log/slog"
	"net/http"

	"github.com/coder/websocket"
	"github.com/misrab/pi-app/internal/pi"
)

//go:embed static/*
var staticFS embed.FS

// Server serves the UI and WebSocket bridge.
type Server struct {
	piOpts pi.Options
}

// New creates a web server that spawns pi sessions with the given options.
func New(piOpts pi.Options) *Server {
	return &Server{piOpts: piOpts}
}

// Handler returns the HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"healthy":true}`))
	})
	mux.HandleFunc("/", s.serveIndex)
	return mux
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	data, err := staticFS.ReadFile("static/index.html")
	if err != nil {
		http.Error(w, "ui not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
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

	// Each connection gets its own pi session.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	session, err := pi.Start(ctx, s.piOpts)
	if err != nil {
		slog.Error("failed to start pi", "err", err)
		conn.Close(websocket.StatusInternalError, "failed to start pi")
		return
	}
	defer session.Close()

	// pi events -> browser
	go func() {
		for ev := range session.Events() {
			if err := conn.Write(ctx, websocket.MessageText, ev); err != nil {
				cancel()
				return
			}
		}
		// pi exited
		cancel()
	}()

	// browser commands -> pi
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if err := session.Send(data); err != nil {
			slog.Error("failed to send to pi", "err", err)
			return
		}
	}
}
