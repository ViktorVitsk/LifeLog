import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

function hasChromium(root: string): boolean {
  return (
    existsSync(join(root, "chromium-1243", "chrome-linux64", "chrome")) ||
    existsSync(join(root, "chromium_headless_shell-1243", "chrome-headless-shell-linux64", "chrome-headless-shell"))
  );
}

const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (browsersPath && !hasChromium(browsersPath)) {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
