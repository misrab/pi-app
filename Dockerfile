# --- build the frontend ---
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build   # outputs to /internal/web/dist via vite config

# --- build the Go server (embeds the frontend) ---
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# bring in the built frontend so //go:embed all:dist succeeds
COPY --from=web /internal/web/dist ./internal/web/dist
RUN CGO_ENABLED=0 go build -o /out/pi-app ./cmd/server

# --- runtime: node (for pi) + git/ssh (for config) + the server ---
FROM node:22-alpine
RUN apk add --no-cache git openssh-client \
    && npm install -g @earendil-works/pi-coding-agent

COPY --from=build /out/pi-app /usr/local/bin/pi-app

# pi binary + config storage. Auth is NOT handled here: pi-app passes the whole
# environment through to pi, which resolves auth via its own system (provider
# API-key env vars, ANTHROPIC_OAUTH_TOKEN, or credentials in the .pi config).
ENV PI_BIN=pi
ENV PI_CONFIG_DIR=/data/pi-config
VOLUME /data

EXPOSE 8080
ENTRYPOINT ["pi-app", "--addr", ":8080"]
