import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// No CDN, no external font or script. Everything the browser needs ships
// from this build; see CLAUDE.md "Offline at runtime".
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
    // Must exceed asyncUtilTimeout (src/test-setup.ts) so a slow wait fails with
    // its own message instead of a bare test timeout (#465).
    testTimeout: 30000,
    // Playwright smoke tests (`npm run e2e:shots`) need a running demo server.
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
