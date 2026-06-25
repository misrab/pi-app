# pi-app — web UI for the pi coding agent. All-Node: a single server process
# hosts every chat session in-memory via the pi SDK and serves the React build.

PORT ?= 8080

.PHONY: dev dev-server dev-web build build-web build-server install web-install \
        free-port docker dev-docker dev-stop dev-logs docker-check test

# --- local development ------------------------------------------------------

# Full dev: Node backend on :8080 + Vite dev server on :5173 (proxies /ws+/api).
# Open http://localhost:5173. Uses your ~/.pi/agent config.
dev: install free-port
	@echo "backend :$(PORT)  ·  ui http://localhost:5173"
	@(cd server && PORT=$(PORT) PI_CWD=$(HOME) npm run dev &) && cd web && npm run dev

# Backend only (serves the prebuilt frontend from server/public on :PORT).
dev-server: build-web
	cd server && PORT=$(PORT) PI_CWD=$(HOME) npm run dev

install: web-install
	@cd server && [ -d node_modules ] || npm install

web-install:
	@cd web && [ -d node_modules ] || npm install

free-port:
	@lsof -ti:$(PORT) | xargs kill -9 2>/dev/null || true

# --- tests ------------------------------------------------------------------

test: web-install
	cd web && npm test

# --- production build -------------------------------------------------------

# Build frontend (-> server/public) then compile the server (-> server/dist).
build: build-web build-server

build-web: install
	cd web && npm run build

build-server: install
	cd server && npm run build

# --- docker -----------------------------------------------------------------

docker:
	docker build -t pi-app .

# Local Docker run. Seeds the container's config from your ~/.pi/agent (ro).
dev-docker: docker-check docker free-port
	-docker rm -f pi-app-dev 2>/dev/null
	@echo "pi-app running · http://localhost:$(PORT)  ·  Ctrl+C to stop"
	docker run --rm --name pi-app-dev -p $(PORT):8080 \
		$(if $(wildcard pi.env),--env-file pi.env) \
		-v $(HOME)/.pi/agent:/seed:ro \
		-e PI_CONFIG_SEED=/seed \
		pi-app

docker-check:
	@docker info >/dev/null 2>&1 || { \
		echo "Docker daemon not reachable. Start Docker Desktop and try again."; \
		exit 1; }

dev-stop: docker-check
	-docker rm -f pi-app-dev 2>/dev/null
	@echo "stopped pi-app-dev"

dev-logs: docker-check
	docker logs -f pi-app-dev
