import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build into ../internal/web/dist so the Go binary can embed it.
// In dev, proxy /ws to the Go backend on :8080.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../internal/web/dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/health": "http://localhost:8080",
    },
  },
});
