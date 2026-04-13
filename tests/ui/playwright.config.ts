import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const uiArtifactsDir = path.join(process.cwd(), 'tests', 'ui', 'artifacts');
const allureResultsDir = process.env.ALLURE_RESULTS_DIR || path.join(uiArtifactsDir, 'allure-results');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  reporter: [
    ['line'],
    ['allure-playwright', { resultsDir: allureResultsDir, detail: true, suiteTitle: false }],
    ['json', { outputFile: path.join(uiArtifactsDir, 'playwright-report', 'results.json') }]
  ],
  outputDir: path.join(uiArtifactsDir, 'test-results'),
  use: {
    baseURL: process.env.UI_BASE_URL || 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'on' : 'retain-on-failure'
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
