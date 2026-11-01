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
  },
});
