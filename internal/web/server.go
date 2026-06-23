// Package web serves the chat UI and bridges browser WebSocket connections to
// a per-connection `pi --mode rpc` subprocess. The browser speaks pi's JSON
// protocol directly; this server is essentially a transparent pipe.
package web

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/coder/websocket"
	"github.com/misrab/pi-app/internal/pi"
)

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
	mux.Handle("/", s.spaHandler())
	return mux
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
