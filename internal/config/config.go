// Package config resolves the pi agent config directory. It optionally pulls
// a private config repo from git, degrading gracefully to a default empty
// config when none is available.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
)

// Resolve determines the PI_CODING_AGENT_DIR to use.
//
//   - If repo is empty, returns "" (pi uses its built-in default, ~/.pi/agent).
//   - If repo is set, clones/pulls it into dir and returns dir.
//   - On any git failure, logs a warning and falls back to an empty config at
//     dir so pi still starts.
//
// sshKey, if set, is used as the git SSH identity (GIT_SSH_COMMAND).
func Resolve(repo, dir, sshKey string) string {
	if repo == "" {
		slog.Info("no config repo set, using pi default config")
		return ""
	}

	if err := sync(repo, dir, sshKey); err != nil {
		slog.Warn("config repo sync failed, using empty default", "err", err)
		_ = os.MkdirAll(dir, 0o755)
	}
	return dir
}

func sync(repo, dir, sshKey string) error {
	env := os.Environ()
	if sshKey != "" {
		env = append(env, fmt.Sprintf(
			"GIT_SSH_COMMAND=ssh -i %s -o StrictHostKeyChecking=no", sshKey))
	}

	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		slog.Info("pulling config repo", "dir", dir)
		return run(env, "git", "-C", dir, "pull", "--ff-only", "--quiet")
	}

	slog.Info("cloning config repo", "repo", repo, "dir", dir)
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return err
	}
	return run(env, "git", "clone", "--quiet", repo, dir)
}

func run(env []string, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Env = env
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s: %w: %s", name, err, string(out))
	}
	return nil
}
