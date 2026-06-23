// Command server runs the pi-app web UI: a browser front-end for the pi
// coding agent, bridged over WebSocket to `pi --mode rpc`.
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/misrab/pi-app/internal/config"
	"github.com/misrab/pi-app/internal/pi"
	"github.com/misrab/pi-app/internal/web"
)

func main() {
	var (
		// PORT (injected by tiberius) takes precedence; --addr is the fallback.
		addr       = flag.String("addr", defaultAddr(), "listen address")
		piBin      = flag.String("pi-bin", env("PI_BIN", "pi"), "path to the pi binary")
		configRepo = flag.String("config-repo", env("PI_CONFIG_REPO", ""), "git repo with .pi config (optional)")
		configDir  = flag.String("config-dir", env("PI_CONFIG_DIR", "/data/pi-config"), "where to store pulled config")
		sshKey     = flag.String("ssh-key", env("PI_SSH_KEY", ""), "ssh key for cloning private config repo")
		noSession  = flag.Bool("no-session", false, "run pi without session persistence")
	)
	flag.Parse()

	// Resolve config dir (pulls repo if configured, else empty/default).
	piConfigDir := config.Resolve(*configRepo, *configDir, *sshKey)

	var args []string
	if *noSession {
		args = append(args, "--no-session")
	}

	srv := web.New(pi.Options{
		Bin:       *piBin,
		Args:      args,
		ConfigDir: piConfigDir,
	})

	slog.Info("pi-app listening", "addr", *addr, "pi", *piBin, "config", piConfigDir)
	if err := http.ListenAndServe(*addr, srv.Handler()); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// defaultAddr honours the PORT env var (set by tiberius / many PaaS platforms),
// defaulting to :8080 when unset.
func defaultAddr() string {
	if p := strings.TrimSpace(os.Getenv("PORT")); p != "" {
		return ":" + p
	}
	return ":8080"
}
