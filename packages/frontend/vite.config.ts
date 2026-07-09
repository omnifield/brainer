/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Why: solid plugin compiles JSX; vitest reuses the same transform pipeline so
// tests exercise the real component output, not a divergent build.
// Why: the BFF runs on :8000; the dev server proxies the control-channel surface to it so the app
// talks to same-origin relative paths (/sessions, /api). The proxy streams SSE unbuffered, so the
// live event stream works in dev exactly as it will behind one origin in prod. In prod the app
// points at the backend via VITE_API_BASE (see api/backend/base.ts) instead of this proxy.
const BACKEND = "http://localhost:8000";

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5173,
    proxy: {
      "/sessions": { target: BACKEND, changeOrigin: true },
      "/api": { target: BACKEND, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Why: solid-js ships browser + server conditions; tests need the browser one.
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
    isolate: false,
  },
  resolve: {
    conditions: ["development", "browser"],
  },
});
