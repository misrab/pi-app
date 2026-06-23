// Command server runs the pi-app web UI: a browser front-end for the pi
// coding agent, bridged over WebSocket to `pi --mode rpc`.
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

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
		configSeed = flag.String("config-seed", env("PI_CONFIG_SEED", ""), "source dir to seed portable config from (optional)")
		configDir  = flag.String("config-dir", env("PI_CONFIG_DIR", "/data/pi-config"), "the container's own config dir")
		configSub  = flag.String("config-subdir", env("PI_CONFIG_SUBDIR", ""), "subdir within repo/seed holding the agent config (e.g. 'agent')")
		sshKey     = flag.String("ssh-key", env("PI_SSH_KEY", ""), "ssh key for cloning private config repo")
		configPoll = flag.Duration("config-poll", pollEnv(), "how often to re-pull the config repo (0 disables)")
		sessionDir = flag.String("session-dir", env("PI_SESSION_DIR", "/data/sessions"), "directory for pi session files (resume UI)")
		noSession  = flag.Bool("no-session", false, "run pi without session persistence")
	)
	flag.Parse()

	// Provision the container's own config dir (pull repo or seed from a source
	// dir), then install packages for this platform.
	piConfigDir := config.Resolve(*configRepo, *configSeed, *configDir, *configSub, *sshKey, *piBin)

	// Periodically re-pull the config repo so edits to .pi propagate without a
	// redeploy. New chat sessions spawn fresh pi processes that read the update.
	if *configRepo != "" && *configPoll > 0 {
		go func() {
			for range time.Tick(*configPoll) {
				config.Repull(*configRepo, *configDir, *configSub, *sshKey, *piBin)
			}
		}()
	}

	// Use an explicit, flat session dir so listing + switching is deterministic
	// (pi otherwise nests sessions under a cwd-derived slug).
	var args []string
	if *noSession {
		args = append(args, "--no-session")
	} else {
		_ = os.MkdirAll(*sessionDir, 0o755)
		args = append(args, "--session-dir", *sessionDir)
	}
	// Extra args forwarded to pi (e.g. PI_ARGS="--no-extensions").
	if extra := strings.Fields(os.Getenv("PI_ARGS")); len(extra) > 0 {
		args = append(args, extra...)
	}

	srv := web.New(pi.Options{
		Bin:       *piBin,
		Args:      args,
		ConfigDir: piConfigDir,
	}, *sessionDir)

	slog.Info("pi-app listening", "addr", *addr, "pi", *piBin, "config", piConfigDir, "sessions", *sessionDir)
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

// pollEnv reads PI_CONFIG_POLL (a duration) or defaults to 2m.
func pollEnv() time.Duration {
	if v := strings.TrimSpace(os.Getenv("PI_CONFIG_POLL")); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return 2 * time.Minute
}

// defaultAddr honours the PORT env var (set by tiberius / many PaaS platforms),
// defaulting to :8080 when unset.
func defaultAddr() string {
	if p := strings.TrimSpace(os.Getenv("PORT")); p != "" {
		return ":" + p
	}
	return ":8080"
}
