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
  await addMock({ method: 'GET', path: '/api/agents', status: 200, body: { agents: [
    { id: 'engineer', name: 'Engineer', role: 'engineer', state: { id: 'engineer', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
    { id: 'architect', name: 'Architect', role: 'architect', state: { id: 'architect', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
    { id: 'game_designer', name: 'Game Designer', role: 'game_designer', state: { id: 'game_designer', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
    { id: 'biz_designer', name: 'Business Designer', role: 'biz_designer', state: { id: 'biz_designer', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
    { id: 'ceo', name: 'CEO', role: 'ceo', state: { id: 'ceo', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } },
    { id: 'team_builder', name: 'Team Building', role: 'team_builder', state: { id: 'team_builder', status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false } }
  ] } });

  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Game Dev Studio' })).toBeVisible();
  await expect(page.getByText('Overview', { exact: true })).toBeVisible();
  await expect(page.getByText('Connected')).toBeVisible();
});

test('[UI-002] should switch language to chinese', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByRole('button', { name: '中文' }).click();

  await expect(page.getByRole('button', { name: '团队总览' })).toBeVisible();
  await expect(page.getByText('已连接')).toBeVisible();
});

test('[UI-003] should toggle autopilot setting', async ({ page }) => {
  await addMock({
    method: 'PATCH',
    path: '/api/projects/default/settings',
    status: 200,
    body: { settings: { project_id: 'default', autopilot_enabled: true } }
  });

  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Autopilot Mode')).toBeVisible();

  await page.getByRole('button', { name: 'Disabled' }).click();
  await expect(page.getByRole('button', { name: 'Enabled' })).toBeVisible();
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

  await page.getByPlaceholder('New project name').fill('demo ui');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText('project demo-ui')).toBeVisible();
});

test('[UI-005] should navigate major tabs', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  for (const tab of ['Team Building', 'Proposals', 'Task Board', 'Handoffs', 'Settings', 'Games', 'Logs', 'Commands']) {
    await page.getByRole('button', { name: tab }).click();
    await expect(page.getByRole('button', { name: tab })).toBeVisible();
  }
});
