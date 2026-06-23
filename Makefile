# pi-app — web UI for the pi coding agent.

ADDR ?= :8080

.PHONY: dev dev-web dev-server build build-web web-install free-port docker dev-docker tidy test

# --- local development ------------------------------------------------------

# Full dev: Go backend on :8080 + Vite dev server on :5173 (proxies /ws).
# Open http://localhost:5173. Requires `pi` on PATH.
dev: web-install free-port
	@echo "backend :8080  ·  ui http://localhost:5173"
	@(go run ./cmd/server --addr :8080 --session-dir .dev-sessions &) && cd web && npm run dev

# Backend only (serves the prebuilt embedded UI on :8080).
dev-server: free-port
	go run ./cmd/server --addr $(ADDR) --session-dir .dev-sessions

web-install:
	@cd web && [ -d node_modules ] || npm install

free-port:
	@lsof -ti$(ADDR) | xargs kill -9 2>/dev/null || true

# --- production build -------------------------------------------------------

# Build frontend into internal/web/dist, then the single Go binary.
build: build-web
	CGO_ENABLED=0 go build -o bin/pi-app ./cmd/server

build-web: web-install
	cd web && npm run build

# --- docker -----------------------------------------------------------------

docker:
	docker build -t pi-app .

# Local Docker run. Stops any stale container, then seeds the container's own
# config from your ~/.pi/agent (read-only) — portable files only. Extensions are
# installed fresh inside the container for Linux, so macOS native binaries never
# leak in and your host config is never mutated.
dev-docker: docker free-port
	-docker rm -f pi-app-dev 2>/dev/null
	docker run --rm -it --name pi-app-dev -p $(patsubst :%,%,$(ADDR)):8080 \
		$(if $(wildcard pi.env),--env-file pi.env) \
		-v $(HOME)/.pi/agent:/seed:ro \
		-e PI_CONFIG_SEED=/seed \
		pi-app --no-session

tidy:
	go mod tidy

test:
	go test ./...
