import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Smoke test + screenshots against an already-running demo server
// (`.venv/bin/python scripts/dev_demo.py`). Not part of `npm test` (vitest)
// and not run in CI.
const useSystemChrome = existsSync("/usr/bin/google-chrome");

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.DEMO_URL ?? "http://127.0.0.1:8000",
    ...(useSystemChrome ? { channel: "chrome" as const } : {}),
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "iphone",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      name: "small",
      use: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
});
