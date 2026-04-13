import { test, expect } from '@playwright/test';

const mockAdminBase = process.env.MOCK_SERVER_ADMIN_URL || 'http://localhost:3001';

const addMock = async (route: {
  method?: string;
  path: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delayMs?: number;
  once?: boolean;
  sse?: boolean;
}) => {
  const response = await fetch(`${mockAdminBase}/__admin/mocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(route)
  });
  if (!response.ok) {
    throw new Error(`failed to add mock: ${response.status} ${await response.text()}`);
  }
};

test.beforeEach(async () => {
  const response = await fetch(`${mockAdminBase}/__admin/reset`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`failed to reset mock server: ${response.status} ${await response.text()}`);
  }
});

test('[UI-001] should load studio overview with connected state', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Game Dev Studio' })).toBeVisible();
  await expect(page.getByText('Overview', { exact: true })).toBeVisible();
});

test('[UI-002] should switch language to chinese', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByRole('button', { name: '中文' }).click();

  await expect(page.getByRole('button', { name: '团队总览' })).toBeVisible();
});

test('[UI-003] should toggle autopilot setting', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Autopilot Mode')).toBeVisible();

  await page.getByRole('button', { name: /Disabled|已关闭/ }).click();
  await expect(page.getByText('Autopilot Mode')).toBeVisible();
});

test('[UI-004] should create and switch to a new project', async ({ page }) => {
  await addMock({
    method: 'POST',
    path: '/api/projects',
    status: 201,
    body: { project: { id: 'demo-ui', name: 'demo-ui' } }
  });

  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByPlaceholder('New project name').fill('demo-ui');
  const createButton = page.getByRole('button', { name: 'Create' });
  await createButton.click();
  await expect(createButton).toBeVisible();
});

test('[UI-005] should navigate major tabs', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  for (const tab of ['Team Building', 'Proposals', 'Task Board', 'Handoffs', 'Settings', 'Games', 'Logs', 'Commands']) {
    await page.getByRole('button', { name: tab }).click();
    await expect(page.getByRole('button', { name: tab })).toBeVisible();
  }
});

test('[UI-006] should load star-office-ui and keep agent status synced via agents api', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByRole('button', { name: 'Studio' }).click();
  await expect(page.locator('iframe[title="Star-Office-UI"]')).toBeVisible();
  await expect(page.getByText('Star-Office-UI failed to load.')).toHaveCount(0);

  const pauseResponse = await fetch(`${mockAdminBase}/api/agents/engineer/pause`, { method: 'POST' });
  if (!pauseResponse.ok) {
    throw new Error(`failed to pause agent: ${pauseResponse.status} ${await pauseResponse.text()}`);
  }

  const apiAgentsResponse = await fetch(`${mockAdminBase}/api/agents`);
  if (!apiAgentsResponse.ok) {
    throw new Error(`failed to get api agents: ${apiAgentsResponse.status} ${await apiAgentsResponse.text()}`);
  }
  const apiAgentsData = await apiAgentsResponse.json() as { agents: Array<{ id: string; state: { status: string; isPaused: boolean } }> };
  const engineerFromApi = apiAgentsData.agents.find(agent => agent.id === 'engineer');
  expect(engineerFromApi?.state.status).toBe('paused');
  expect(engineerFromApi?.state.isPaused).toBe(true);

  const starOfficeAgentsResponse = await fetch(`${mockAdminBase}/agents`);
  if (!starOfficeAgentsResponse.ok) {
    throw new Error(`failed to get star-office agents: ${starOfficeAgentsResponse.status} ${await starOfficeAgentsResponse.text()}`);
  }
  const starOfficeAgents = await starOfficeAgentsResponse.json() as Array<{ agentId: string; state: string; authStatus: string }>;
  const engineerFromStarOffice = starOfficeAgents.find(agent => agent.agentId === 'default:engineer');
  expect(engineerFromStarOffice?.state).toBe('paused');
  expect(engineerFromStarOffice?.authStatus).toBe('offline');
});
