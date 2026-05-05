import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Panel-side unit tests only. Excluded files run as part of the
    // sidecar's own vitest (cd sidecar && npm test).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["sidecar/**", "node_modules/**", "dist/**"],
    environment: "node",
    globals: false,
  },
});
