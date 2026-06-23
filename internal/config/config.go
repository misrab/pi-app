// Package config provisions the pi agent config directory for the platform the
// container runs on. The guiding principle: the container OWNS its config dir.
// Portable text (settings, memory, prompts) is pulled from git or seeded from a
// source dir; platform-specific artifacts (installed extensions, native
// binaries) are (re)built locally via `pi install` so they match this platform.
package config

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
)

// excluded are never copied/seeded — they are platform-specific, generated, or
// secret, and must be rebuilt or supplied per-platform.
var excluded = map[string]bool{
	"git":          true, // installed git packages (native binaries)
	"npm":          true, // installed npm packages (native binaries)
	"bin":          true, // downloaded binaries
	"node_modules": true,
	"sessions":     true, // local chat logs
	".git":         true,
}

// Resolve provisions the config dir and returns the path pi should use.
//
//   - repo set    → clone/pull it into dir.
//   - seed set    → copy portable files from seed into dir (host config sharing).
//   - neither     → returns "" (pi uses its built-in default).
//
// After provisioning, packages declared in settings.json are installed for THIS
// platform. Failures degrade gracefully so pi still starts.
// subdir, if set, is the path within repo/seed that holds the pi agent config
// (e.g. "agent" when the repo root is a `.pi` directory). The returned path
// points at that subdir.
func Resolve(repo, seed, dir, subdir, sshKey, piBin string) string {
	switch {
	case repo != "":
		if err := sync(repo, dir, sshKey); err != nil {
			slog.Warn("config repo sync failed, using empty default", "err", err)
			_ = os.MkdirAll(dir, 0o755)
		}
	case seed != "":
		slog.Info("seeding config from source", "src", seed, "dir", dir)
		if err := seedDir(seed, dir); err != nil {
			slog.Warn("config seed failed, using empty default", "err", err)
			_ = os.MkdirAll(dir, 0o755)
		}
	default:
		slog.Info("no config repo or seed set, using pi default config")
		return ""
	}

	agentDir := dir
	if subdir != "" {
		agentDir = filepath.Join(dir, subdir)
	}
	installPackages(agentDir, piBin)
	return agentDir
}

// OverlayAuth copies an auth.json file into the agent config dir so pi can find
// it. Call after Resolve. Safe to call if src is empty or missing.
func OverlayAuth(src, agentDir string) {
	if src == "" || agentDir == "" {
		return
	}
	if _, err := os.Stat(src); err != nil {
		return // not mounted, skip silently
	}
	if err := os.MkdirAll(agentDir, 0o755); err != nil {
		slog.Warn("overlay auth: mkdir failed", "err", err)
		return
	}
	dst := filepath.Join(agentDir, "auth.json")
	if err := copyFile(src, dst, must(os.Stat(src))); err != nil {
		slog.Warn("overlay auth: copy failed", "err", err)
		return
	}
	slog.Info("auth.json overlaid", "dst", dst)
}

func must(fi os.FileInfo, err error) os.FileInfo {
	if err != nil {
		panic(err)
	}
	return fi
}

// Repull fast-forwards the config repo; if HEAD moved, updates submodules and
// reinstalls packages. New chat sessions (fresh pi subprocesses) then pick up
// the updated config. Best-effort; safe to call on a ticker.
func Repull(repo, dir, subdir, sshKey, piBin string) {
	if repo == "" {
		return
	}
	before := gitHead(dir)
	if err := sync(repo, dir, sshKey); err != nil {
		slog.Warn("config re-pull failed", "err", err)
		return
	}
	if gitHead(dir) == before {
		return // no change
	}
	slog.Info("config updated, reinstalling packages")
	agentDir := dir
	if subdir != "" {
		agentDir = filepath.Join(dir, subdir)
	}
	installPackages(agentDir, piBin)
}

func gitHead(dir string) string {
	out, err := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if err != nil {
		return ""
	}
	return string(out)
}

// sync clones or fast-forward-pulls the config repo.
func sync(repo, dir, sshKey string) error {
	env := os.Environ()
	if sshKey != "" {
		env = append(env, fmt.Sprintf(
			"GIT_SSH_COMMAND=ssh -i %s -o StrictHostKeyChecking=no", sshKey))
	}

	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		slog.Info("pulling config repo", "dir", dir)
		if err := run(env, "git", "-C", dir, "pull", "--ff-only", "--quiet"); err != nil {
			return err
		}
		return run(env, "git", "-C", dir, "submodule", "update", "--init", "--recursive", "--quiet")
	}

	slog.Info("cloning config repo", "repo", repo, "dir", dir)
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return err
	}
	return run(env, "git", "clone", "--quiet", "--recurse-submodules", repo, dir)
}

// seedDir copies portable config files from src into dir, skipping excluded
// (platform-specific / generated / secret) entries. Never mutates src.
func seedDir(src, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if excluded[e.Name()] {
			continue
		}
		if err := copyAny(filepath.Join(src, e.Name()), filepath.Join(dir, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

// installPackages installs the packages declared in settings.json for this
// platform, so native modules are built correctly. Best-effort.
func installPackages(dir, piBin string) {
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		return // no settings, nothing to install
	}
	var settings struct {
		Packages []string `json:"packages"`
	}
	if json.Unmarshal(data, &settings) != nil || len(settings.Packages) == 0 {
		return
	}

	env := append(os.Environ(), "PI_CODING_AGENT_DIR="+dir)
	for _, pkg := range settings.Packages {
		slog.Info("installing pi package", "pkg", pkg)
		if err := run(env, piBin, "install", pkg); err != nil {
			slog.Warn("package install failed", "pkg", pkg, "err", err)
		}
	}
}

// --- fs helpers -------------------------------------------------------------

func copyAny(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return copyDir(src, dst)
	}
	return copyFile(src, dst, info)
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyAny(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string, info os.FileInfo) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func run(env []string, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Env = env
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s: %w: %s", name, err, string(out))
	}
	return nil
}
