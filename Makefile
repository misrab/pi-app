# pi-app — web UI for the pi coding agent.

ADDR ?= :8080

.PHONY: dev build docker tidy test

# Free the dev port if something's already bound to it.
free-port:
	@lsof -ti$(ADDR) | xargs kill -9 2>/dev/null || true

# Run locally against your installed pi + default config. Open http://localhost:8080
# Uses your real ~/.pi/agent config (read), but does NOT persist sessions.
dev: free-port
	go run ./cmd/server --addr $(ADDR) --no-session

build:
	CGO_ENABLED=0 go build -o bin/pi-app ./cmd/server

docker:
	docker build -t pi-app .

# Isolated local run: pi only touches the container, not your laptop.
# Rebuilds image (npm layer is cached, so it's fast after the first time).
dev-docker: docker free-port
	docker run --rm -it -p $(patsubst :%,%,$(ADDR)):8080 \
		-e ANTHROPIC_API_KEY \
		pi-app --no-session

tidy:
	go mod tidy

test:
	go test ./...
