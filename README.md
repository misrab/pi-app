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
| `--config-repo` | `PI_CONFIG_REPO` | — | git repo holding your `.pi` config (optional) |
| `--config-dir` | `PI_CONFIG_DIR` | `/data/pi-config` | where the pulled config is stored |
| `--ssh-key` | `PI_SSH_KEY` | — | ssh key for cloning a private config repo |
| `--no-session` | — | false | run pi without session persistence |

### Config resolution (graceful)

- No `config-repo` → pi uses its built-in default (`~/.pi/agent`).
- `config-repo` set → cloned/pulled into `config-dir`, used via `PI_CODING_AGENT_DIR`.
- Git failure → logs a warning and falls back to an empty config so pi still starts.

## Auth

pi-app does **not** manage provider credentials. It passes the entire environment
through to the `pi` subprocess, which resolves auth via its own system:

- provider API-key env vars (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), or
- `ANTHROPIC_OAUTH_TOKEN` for Claude Pro/Max, or
- credentials stored in your `.pi` config.

Whatever works when you run `pi` in a terminal works here — nothing pi-app-specific.

## Docker

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
- Model picker: switch model, set thinking level
- Sessions: new, rename, clone, fork from any message
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
