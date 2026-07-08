/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Why: solid plugin compiles JSX; vitest reuses the same transform pipeline so
// tests exercise the real component output, not a divergent build.
export default defineConfig({
  plugins: [solid()],
  server: { port: 3500, strictPort: true },
  preview: { port: 3500, strictPort: true },
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
