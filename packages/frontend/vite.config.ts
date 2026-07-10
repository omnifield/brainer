/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Why: solid plugin compiles JSX; vitest reuses the same transform pipeline so
// tests exercise the real component output, not a divergent build.
// Why: the app is served under /brainer/ behind the nginx gateway (:8080) — the single origin for
// both dev and prod. Assets/index live under that base; the control-channel surface is reached
// same-origin via VITE_API_BASE=/api/brainer (see api/backend/base.ts), which the gateway proxies
// to the backend. No dev proxy: direct ports (:3500/:8010) are gateway-internal targets, not a flow.
export default defineConfig({
  base: "/brainer/",
  plugins: [solid()],
  server: {
    // Why: strictPort — a taken port must fail loud, not silently hop to a neighbour, which would
    // break the gateway's fixed upstream (host.docker.internal:3500) with no signal (canon: loud refusal).
    port: 3500,
    strictPort: true,
  },
  preview: {
    port: 3500,
    strictPort: true,
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
