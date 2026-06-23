import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build into ../server/public so the Node server can serve it.
// In dev, proxy /ws + /api to the Node backend on :8080.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../server/public",
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
