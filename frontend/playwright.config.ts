import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const realE2E = process.env.E2E_REAL === "1";
const apiPort = process.env.E2E_API_PORT ?? "13000";
const apiBaseUrl = process.env.E2E_API_BASE_URL ?? (realE2E ? `http://127.0.0.1:${apiPort}` : "http://127.0.0.1:3000");
const frontendUrl = process.env.E2E_FRONTEND_URL ?? "http://127.0.0.1:18080";

const frontendServer = {
  command: "npm run dev -- --host 127.0.0.1 --port 18080",
  url: frontendUrl,
  reuseExistingServer: false,
  cwd: __dirname,
  env: {
    VITE_API_BASE_URL: apiBaseUrl,
    VITE_E2E: "true",
  },
};

const backendServer = {
  command: "npm run start",
  url: `${apiBaseUrl}/health`,
  reuseExistingServer: false,
  cwd: path.resolve(__dirname, "../backend"),
  timeout: 120_000,
  env: {
    PORT: apiPort,
    RUN_INDEXER: "false",
    ALLOW_LEGACY_TICKET_ID_SCAN: "true",
    CORS_ORIGINS: "http://127.0.0.1:18080,http://localhost:18080",
    JWT_SECRET: process.env.JWT_SECRET ?? "stellar-tickets-dev-secret-change-in-prod",
  },
};

export default defineConfig({
  testDir: "./e2e",
  testIgnore: realE2E ? ["**/demo-flow.spec.ts"] : ["**/real-flow.spec.ts"],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: frontendUrl,
    trace: "retain-on-failure",
  },
  webServer: realE2E ? [backendServer, frontendServer] : frontendServer,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
