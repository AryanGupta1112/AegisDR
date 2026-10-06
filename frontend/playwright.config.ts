import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.AEGIS_E2E_URL || "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.AEGIS_BROWSER_EXECUTABLE || undefined,
    },
  },
  reporter: "list",
  timeout: 60000,
});
