package web

import "embed"

// dist holds the built Vite frontend. Run `make build-web` (or the top-level
// `make build`) to populate internal/web/dist before building the Go binary.
//
//go:embed all:dist
var dist embed.FS
