# pi-app — web UI for the pi coding agent.

ADDR ?= :8080

.PHONY: dev dev-web dev-server build build-web web-install free-port docker dev-docker tidy test

# --- local development ------------------------------------------------------

# Full dev: Go backend on :8080 + Vite dev server on :5173 (proxies /ws).
# Open http://localhost:5173. Requires `pi` on PATH.
dev: web-install free-port
	@echo "backend :8080  ·  ui http://localhost:5173"
	@(go run ./cmd/server --addr :8080 --no-session &) && cd web && npm run dev

# Backend only (serves the prebuilt embedded UI on :8080).
dev-server: free-port
	go run ./cmd/server --addr $(ADDR) --no-session

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

dev-docker: docker free-port
	docker run --rm -it -p $(patsubst :%,%,$(ADDR)):8080 \
		$(if $(wildcard pi.env),--env-file pi.env) \
		pi-app --no-session

tidy:
	go mod tidy

test:
	go test ./...
