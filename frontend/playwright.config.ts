import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3101" },
  webServer: {
    command: "node test/browser/selection-server.mjs",
    url: "http://127.0.0.1:3101",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
