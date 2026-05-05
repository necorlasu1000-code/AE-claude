import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Panel-side unit tests only. Excluded files run as part of the
    // sidecar's own vitest (cd sidecar && npm test).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["sidecar/**", "node_modules/**", "dist/**"],
    // Default environment is node. UI tests that need DOM (xterm,
    // ResizeObserver, etc.) opt in via `// @vitest-environment jsdom`
    // file-level directive — keeps launcher.test.ts cheap (no DOM init).
    environment: "node",
    globals: false,
  },
});
