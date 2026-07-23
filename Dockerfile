# --- build frontend + server -------------------------------------------------
# git is needed to install the make-pwa / web-kit frontend deps from GitHub.
FROM node:22-alpine AS build
RUN apk add --no-cache git
WORKDIR /app

# Frontend deps + source. Vite builds into ../server/public, so the server
# package must be present at build time for the output path to resolve.
COPY web/package*.json web/
RUN cd web && npm ci
COPY server/package*.json server/
RUN cd server && npm ci
COPY web/ web/
COPY server/ server/

RUN cd web && npm run build        # -> /app/server/public
RUN cd server && npm run build     # tsc -> /app/server/dist

# --- production deps only ----------------------------------------------------
FROM node:22-alpine AS proddeps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# --- runtime -----------------------------------------------------------------
# git: HTTPS clone of private .pi config at startup.
# curl + python3: baseline tools the agent expects for HTTP/data work.
# tini: PID 1 reaper — node does not waitpid(-1) orphans; without this, bash/git
# grandchildren accumulate as zombies and eventually fork() fails (EAGAIN).
FROM node:22-alpine
RUN apk add --no-cache tini git curl python3
WORKDIR /app/server

COPY --from=proddeps /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/public ./public
COPY server/package.json ./

# Use the bundled SDK's own pi binary for config provisioning (`pi install`),
# so the CLI and the in-process SDK are the exact same version.
ENV PI_BIN=/app/server/node_modules/.bin/pi
ENV PI_CONFIG_DIR=/data/pi-config
# The agent's working dir (where its file tools operate) + session storage
# slug. Persisted via the /data volume.
ENV PI_CWD=/data/workspace
VOLUME /data

EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/index.js"]
