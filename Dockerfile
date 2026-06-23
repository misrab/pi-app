# --- build the Go server ---
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/pi-app ./cmd/server

# --- runtime: node (for pi) + git/ssh (for config) + the server ---
FROM node:22-alpine
RUN apk add --no-cache git openssh-client \
    && npm install -g @earendil-works/pi-coding-agent

COPY --from=build /out/pi-app /usr/local/bin/pi-app

# pi binary, config storage
ENV PI_BIN=pi
ENV PI_CONFIG_DIR=/data/pi-config
VOLUME /data

EXPOSE 8080
ENTRYPOINT ["pi-app", "--addr", ":8080"]
