import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  reporter: [
    ['line'],
    ['allure-playwright', { outputFolder: 'artifacts/allure-results', detail: true, suiteTitle: false }],
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
