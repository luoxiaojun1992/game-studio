import { defineConfig, devices } from '@playwright/test';

const allureResultsDir = process.env.ALLURE_RESULTS_DIR || 'artifacts/allure-results';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  reporter: [
    ['line'],
    ['allure-playwright', { outputFolder: allureResultsDir, detail: true, suiteTitle: false }],
    ['json', { outputFile: 'artifacts/playwright-report/results.json' }]
  ],
  outputDir: 'artifacts/test-results',
  use: {
    baseURL: process.env.UI_BASE_URL || 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  expect: {
    timeout: 10_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
