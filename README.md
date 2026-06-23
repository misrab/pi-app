# pi-app

A small web UI for the [pi](https://pi.dev) coding agent. A Go server spawns
`pi --mode rpc`, bridges it to the browser over WebSocket, and serves a chat UI.
The browser speaks pi's JSON protocol directly — the server is a transparent pipe.

## Run locally

Requires `pi` on your PATH.

```bash
make dev          # http://localhost:8080
```

Uses your existing `~/.pi/agent` config by default.

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

## Docker

```bash
make docker
docker run -p 8080:8080 \
  -e PI_CONFIG_REPO=git@github.com:you/pi-config.git \
  -e PI_SSH_KEY=/run/secrets/deploy_key \
  -e ANTHROPIC_API_KEY=... \
  -v /home/ec2-user/.ssh/deploy_key:/run/secrets/deploy_key:ro \
  pi-app
```

The image bundles Node + pi, git, and ssh.

## Layout

```
cmd/server/            entrypoint, flags
internal/pi/           pi --mode rpc subprocess wrapper (JSONL framing)
internal/config/       config repo resolution (graceful degradation)
internal/web/          websocket bridge + static UI
internal/web/static/   chat UI (single HTML file)
Dockerfile
```
