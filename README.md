# pi-app

A mobile-first web UI for the [pi](https://pi.dev) coding agent. A Go server
spawns `pi --mode rpc`, bridges it to the browser over WebSocket, and serves a
React app that speaks pi's JSON protocol directly. The frontend is built with
Vite and embedded into the single Go binary.

## Run locally

Requires `pi` and Node on your PATH.

```bash
make dev          # Go backend :8080 + Vite dev server (HMR) → http://localhost:5173
```

Uses your existing `~/.pi/agent` config and does not persist sessions.

Production build (embedded UI, single binary):

```bash
make build && ./bin/pi-app --no-session   # http://localhost:8080
```

## Configuration

All flags have env-var equivalents.

| flag | env | default | purpose |
|------|-----|---------|---------|
| `--addr` | — | `:8080` | listen address |
| `--pi-bin` | `PI_BIN` | `pi` | path to the pi binary |
| `--config-repo` | `PI_CONFIG_REPO` | — | git repo holding your `.pi` config |
| `--config-seed` | `PI_CONFIG_SEED` | — | source dir to seed portable config from |
| `--config-dir` | `PI_CONFIG_DIR` | `/data/pi-config` | the container's own config dir |
| `--config-subdir` | `PI_CONFIG_SUBDIR` | — | subdir holding the agent config (e.g. `agent`) |
| `--config-poll` | `PI_CONFIG_POLL` | `2m` | how often to re-pull the config repo (0 disables) |
| `--ssh-key` | `PI_SSH_KEY` | — | ssh key for cloning a private config repo |
| `--no-session` | — | false | run pi without session persistence |

### Config resolution (graceful)

The container always owns its config dir. Portable text is provisioned in;
platform-specific extensions are installed fresh for the running platform.

- `config-repo` set → clone/pull into `config-dir` (production).
- `config-seed` set → copy portable files from a source dir (local dev).
- neither → pi uses its built-in default (`~/.pi/agent`).
- After provisioning, packages in `settings.json` are installed via `pi install`
  so native binaries match this platform.
- Excluded from seeding: `git/`, `npm/`, `bin/`, `node_modules/`, `sessions/`.
- Any failure degrades gracefully so pi still starts.

### What updates how

Three independent things, three mechanisms:

| Change | How it propagates |
|--------|-------------------|
| **pi CLI version** | rebuild the pi-app image (the Dockerfile installs latest pi). Don't run `pi update` on the server — wrong model for containers. |
| **pi-app code** | push pi-app → CI builds image → tiberius pulls new digest → restarts. |
| **`.pi` config** | re-pulled every `config-poll` (2m). Edits to settings/AGENTS/memory apply to **new** chat sessions automatically — no redeploy. |

## Auth

pi-app does **not** manage provider credentials. It passes the entire environment
through to the `pi` subprocess, which resolves auth via its own system:

- provider API-key env vars (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), or
- `ANTHROPIC_OAUTH_TOKEN` for Claude Pro/Max, or
- credentials stored in your `.pi` config.

Whatever works when you run `pi` in a terminal works here — nothing pi-app-specific.

## Docker

Local run (seeds the container's own config from your `~/.pi/agent`):

```bash
make dev-docker        # http://localhost:8080
```

> **The container owns its config dir.** It copies *portable* files from your
> `~/.pi/agent` (settings, auth, memory, prompts) but never the installed
> `git/`, `npm/`, `bin/` dirs — those hold platform-specific native binaries.
> Extensions are installed fresh **inside** the container for Linux. Your host
> config is mounted read-only and never mutated.

Production:

```bash
make docker
docker run -p 8080:8080 \
  -e PI_CONFIG_REPO=git@github.com:you/pi-config.git \
  -e PI_SSH_KEY=/run/secrets/deploy_key \
  -v /home/ec2-user/.ssh/deploy_key:/run/secrets/deploy_key:ro \
  --env-file pi.env \
  pi-app
```

Put whatever auth `pi` needs in `pi.env` (or pass `-e`). The image bundles
Node + pi, git, and ssh.

## Features

- Streaming chat: text, thinking blocks, tool calls + results, abort
- Model picker: switch model; cycle thinking level from the header (like shift+tab)
- Sessions: new, rename, resume past sessions (with full transcript reload)
- Live stats: cost, tokens, context-window usage

## Layout

```
cmd/server/            entrypoint, flags
internal/pi/           pi --mode rpc subprocess wrapper (JSONL framing)
internal/config/       config repo resolution (graceful degradation)
internal/web/          websocket bridge + embedded SPA (embed.go, server.go)
internal/web/dist/     built frontend (generated, gitignored)
web/                   React + Vite + TypeScript frontend
  src/api/             typed pi RPC protocol + WebSocket client
  src/hooks/           useSession state machine
  src/components/      Header, Transcript, Composer, sheets
Dockerfile             3-stage: build web → build go → node+pi runtime
```
