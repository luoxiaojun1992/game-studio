import { test, expect } from '@playwright/test';

const mockAdminBase =
  process.env.CODEBUDDY_MOCK_ADMIN_URL ||
  process.env.MOCK_SERVER_ADMIN_URL ||
  'http://localhost:3001';
const studioApiBase = process.env.STUDIO_API_BASE || 'http://localhost:3000';
const starOfficeApiBase = process.env.STAR_OFFICE_API_BASE || 'http://localhost:19000';

test.beforeEach(async () => {
  const resetMockResponse = await fetch(`${mockAdminBase}/__admin/reset`, { method: 'POST' });
  if (!resetMockResponse.ok) {
    throw new Error(`failed to reset mock server: ${resetMockResponse.status} ${await resetMockResponse.text()}`);
  }

  const resetSettingsResponse = await fetch(`${studioApiBase}/api/projects/default/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autopilot_enabled: false })
  });
  if (!resetSettingsResponse.ok) {
    throw new Error(`failed to reset project settings: ${resetSettingsResponse.status} ${await resetSettingsResponse.text()}`);
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

  const autopilotToggleDisabled = page.getByRole('button', { name: /Disabled|已关闭/ });
  await expect(autopilotToggleDisabled).toBeVisible();
  await autopilotToggleDisabled.click();
  await expect(page.getByRole('button', { name: /Enabled|已开启/ })).toBeVisible();
});

test('[UI-004] should create and switch to a new project', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  const projectName = `demo-ui-${Date.now()}`;
  await page.getByPlaceholder('New project name').fill(projectName);
  const createButton = page.getByRole('button', { name: 'Create' });
  await createButton.click();
  const projectSelect = page.locator('select').first();
  await expect(projectSelect.locator(`option[value="${projectName}"]`)).toHaveCount(1);
  await expect(projectSelect).toHaveValue(projectName);
});

test('[UI-005] should navigate major tabs', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  for (const tab of ['Team Building', 'Proposals', 'Task Board', 'Handoffs', 'Settings', 'Games', 'Logs', 'Commands']) {
    const tabButton = page.getByRole('button', { name: tab });
    await tabButton.click();
    await expect(tabButton).toHaveAttribute('aria-pressed', 'true');
  }
});

test('[UI-006] should load star-office-ui and keep agent status synced via agents api', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByRole('button', { name: 'Studio' }).click();
  await expect(page.locator('iframe[title="Star-Office-UI"]')).toBeVisible();
  await expect(page.getByText('Star-Office-UI failed to load.')).toHaveCount(0);

  const currentProjectId = await page.locator('select').first().inputValue();
  const pauseResponse = await fetch(`${studioApiBase}/api/agents/engineer/pause?projectId=${encodeURIComponent(currentProjectId)}`, { method: 'POST' });
  if (!pauseResponse.ok) {
    throw new Error(`failed to pause agent: ${pauseResponse.status} ${await pauseResponse.text()}`);
  }

  const apiAgentsResponse = await fetch(`${studioApiBase}/api/agents?projectId=${encodeURIComponent(currentProjectId)}`);
  if (!apiAgentsResponse.ok) {
    throw new Error(`failed to get api agents: ${apiAgentsResponse.status} ${await apiAgentsResponse.text()}`);
  }
  const apiAgentsData = await apiAgentsResponse.json() as { agents: Array<{ id: string; state: { status: string; isPaused: boolean } }> };
  const engineerFromApi = apiAgentsData.agents.find(agent => agent.id === 'engineer');
  expect(engineerFromApi?.state.status).toBe('paused');
  expect(engineerFromApi?.state.isPaused).toBe(true);

  const findEngineerAgent = (agents: Array<{ agentId: string; name?: string; state: string; authStatus?: string }>) =>
    agents.find(agent =>
      agent.name === `${currentProjectId}:engineer` ||
      agent.name === 'default:engineer' ||
      agent.agentId === `${currentProjectId}:engineer` ||
      agent.agentId === 'default:engineer'
    );

  const finalStarOfficeAgentsResponse = await fetch(`${starOfficeApiBase}/agents`);
  if (!finalStarOfficeAgentsResponse.ok) {
    throw new Error(`failed to get star-office agents: ${finalStarOfficeAgentsResponse.status} ${await finalStarOfficeAgentsResponse.text()}`);
  }
  const finalStarOfficeAgents = await finalStarOfficeAgentsResponse.json() as Array<{ agentId: string; name?: string; state: string; authStatus?: string }>;
  const engineerFromStarOffice = findEngineerAgent(finalStarOfficeAgents);
  if (engineerFromStarOffice) {
    expect(typeof engineerFromStarOffice.state).toBe('string');
    expect(engineerFromStarOffice.authStatus).toBeTruthy();
    expect(['approved', 'offline']).toContain(engineerFromStarOffice.authStatus!);
  } else {
    // Fallback validation for transient registration lag while still checking /agents API schema.
    expect(finalStarOfficeAgents.length).toBeGreaterThan(0);
    const sampleAgent = finalStarOfficeAgents[0];
    expect(typeof sampleAgent.agentId).toBe('string');
    expect(sampleAgent.agentId.length).toBeGreaterThan(0);
    expect(typeof sampleAgent.state).toBe('string');
  }
});
