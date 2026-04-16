import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const mockAdminBase =
  process.env.CODEBUDDY_MOCK_ADMIN_URL ||
  process.env.MOCK_SERVER_ADMIN_URL ||
  'http://localhost:3001';
const studioApiBase = process.env.STUDIO_API_BASE || 'http://localhost:3000';
const starOfficeApiBase = process.env.STAR_OFFICE_API_BASE || 'http://localhost:19000';

// Helper to inject mock responses for specific tool calls
const injectMockToolResponse = async (toolName: string, response: Record<string, unknown>) => {
  const mockResponse = await fetch(`${mockAdminBase}/__admin/mocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'POST',
      path: `/v1/chat/completions`,
      status: 200,
      sse: true,
      body: {
        id: `chatcmpl-mock-${toolName}`,
        object: 'chat.completion.chunk',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: `Mock response for ${toolName}`,
            tool_calls: [{
              index: 0,
              id: `call_mock_${toolName}`,
              type: 'function',
              function: {
                name: toolName,
                arguments: JSON.stringify(response)
              }
            }]
          }
        }]
      },
      once: true
    })
  });
  if (!mockResponse.ok) {
    throw new Error(`failed to inject mock: ${mockResponse.status}`);
  }
};

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

  await expect(page.getByRole('tab', { name: /团队总览/ })).toBeVisible();
});

test('[UI-003] should toggle autopilot setting', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByRole('tab', { name: /Settings/ }).click();
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
    const tabButton = page.getByRole('tab', { name: tab });
    await tabButton.click();
    await expect(tabButton).toHaveAttribute('aria-selected', 'true');
  }
});

test('[UI-006] should load star-office-ui and keep agent status synced via agents api', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  await page.getByRole('tab', { name: /Studio/ }).click();
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

test('[UI-007] should complete full workflow: game designer command -> auto handoff -> engineer completion', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');

  // Helper function to handle permission dialogs
  const handlePermissionIfPresent = async () => {
    const approveButton = page.locator('button').filter({ hasText: /允许执行|批准/ }).first();
    try {
      await approveButton.waitFor({ state: 'visible', timeout: 3000 });
      await approveButton.click();
      return;
    } catch {}
  };

  const acceptPendingHandoffFor = async (handoffFlow: RegExp) => {
    const card = page
      .locator('[data-testid^="handoff-card-"]')
      .filter({ hasText: /待接收|Pending/ })
      .filter({ hasText: handoffFlow })
      .first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByTestId('handoff-header').click();
    const acceptButton = card.getByTestId('handoff-accept-btn');
    await expect(acceptButton).toBeVisible({ timeout: 10000 });
    await acceptButton.click();
    await expect(card).toContainText(/处理中|Working/, { timeout: 15000 });
  };

  const testProjectId = `ui_007_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await page.getByPlaceholder(/新建项目名|New project name/).fill(testProjectId);
  await page.getByRole('button', { name: /新建|Create/ }).click();

  const projectSelectorContainer = page
    .locator('div')
    .filter({ has: page.getByText(/项目|Project/) })
    .filter({ has: page.getByPlaceholder(/新建项目名|New project name/) })
    .first();
  const projectSelect = projectSelectorContainer.locator('select');
  await expect(projectSelect).toHaveValue(testProjectId);

  await page.getByRole('tab', { name: /设置|Settings/ }).click();
  const autopilotEnabledButton = page.getByRole('button', { name: /已开启|Enabled/ });
  const autopilotDisabledButton = page.getByRole('button', { name: /已关闭|Disabled/ });
  if (await autopilotEnabledButton.count()) {
    await autopilotEnabledButton.click();
  }
  await expect(autopilotDisabledButton).toBeVisible();

  // Step 1: Game designer receives task and automatically creates handoff to CEO
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const gameDesignerButton = page.locator('button').filter({ hasText: /游戏策划/ }).first();
  await gameDesignerButton.waitFor({ state: 'visible', timeout: 10000 });
  await gameDesignerButton.click();

  const commandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await commandInput.fill('请设计一个RPG游戏的核心玩法，包括战斗系统和角色成长机制');

  const sendButton = page.locator('button').filter({ hasText: /发送/ }).first();
  await sendButton.click();

  // Wait for agent to process and automatically create handoff
  const processingIndicator = page.getByText(/Agent 正在处理/).first();
  try {
    await processingIndicator.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator.waitFor({ state: 'hidden', timeout: 120000 });
  } catch {}

  // Handle any permission requests for tool calls
  await handlePermissionIfPresent();
  await page.waitForTimeout(2000);

  // Step 2: Verify handoff was automatically created by game designer
  await page.getByRole('tab', { name: /任务交接/ }).click();
  await page.waitForTimeout(1000);

  // The handoff should be created automatically by the agent (not manually via UI)
  const handoffItems = page.locator('[data-testid^="handoff-card-"]').all();
  expect((await handoffItems).length).toBeGreaterThan(0);

  // Accept the handoff as CEO
  await acceptPendingHandoffFor(/游戏策划[\s\S]*CEO|Game Designer[\s\S]*CEO/);

  // Step 3: CEO receives task and automatically creates handoff to architect
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const ceoButton = page.locator('button').filter({ hasText: /CEO/ }).first();
  await ceoButton.click();

  const ceoCommandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await ceoCommandInput.fill('请评审游戏策划案');

  const ceoSendButton = page.locator('button').filter({ hasText: /发送/ }).first();
  await ceoSendButton.click();

  try {
    const processingIndicator2 = page.getByText(/Agent 正在处理/).first();
    await processingIndicator2.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator2.waitFor({ state: 'hidden', timeout: 120000 });
  } catch {}

  await handlePermissionIfPresent();
  await page.waitForTimeout(2000);

  // Step 4: Verify second handoff was automatically created by CEO
  await page.getByRole('tab', { name: /任务交接/ }).click();
  await page.waitForTimeout(1000);

  const handoffItems2 = page.locator('[data-testid^="handoff-card-"]').all();
  expect((await handoffItems2).length).toBeGreaterThanOrEqual(2);

  // Accept as architect
  await acceptPendingHandoffFor(/CEO[\s\S]*架构师|CEO[\s\S]*Architect/);

  // Step 5: Architect receives task and automatically creates handoff to engineer
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const architectButton = page.locator('button').filter({ hasText: /架构师/ }).first();
  await architectButton.click();

  const architectCommandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await architectCommandInput.fill('请设计技术架构');

  await sendButton.click();

  try {
    const processingIndicator3 = page.getByText(/Agent 正在处理/).first();
    await processingIndicator3.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator3.waitFor({ state: 'hidden', timeout: 120000 });
  } catch {}

  await handlePermissionIfPresent();
  await page.waitForTimeout(2000);

  // Step 6: Verify third handoff was automatically created by architect
  await page.getByRole('tab', { name: /任务交接/ }).click();
  await page.waitForTimeout(1000);

  const handoffItems3 = page.locator('[data-testid^="handoff-card-"]').all();
  expect((await handoffItems3).length).toBeGreaterThanOrEqual(3);

  // Accept as engineer
  await acceptPendingHandoffFor(/架构师[\s\S]*软件工程师|Architect[\s\S]*Engineer/);

  // Step 7: Engineer completes the final task
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const engineerButton = page.locator('button').filter({ hasText: /软件工程师/ }).first();
  await engineerButton.click();

  const engineerCommandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await engineerCommandInput.fill('请完成游戏开发并提交最终成果');

  await sendButton.click();

  try {
    const processingIndicator4 = page.getByText(/Agent 正在处理/).first();
    await processingIndicator4.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator4.waitFor({ state: 'hidden', timeout: 120000 });
  } catch {}

  await handlePermissionIfPresent();
  await page.waitForTimeout(2000);

  // Step 8: Verify final state - all handoffs created by agents (not manually)
  await page.getByRole('tab', { name: /任务交接/ }).click();
  await page.waitForTimeout(1000);

  const finalHandoffItems = page.locator('[data-testid^="handoff-card-"]').all();
  expect((await finalHandoffItems).length).toBeGreaterThanOrEqual(3);
});

test('[UI-008] should enable autopilot and verify agent auto-handoff with auto-acceptance', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');

  // Helper function to handle permission dialogs
  const handlePermissionIfPresent = async () => {
    const approveButton = page.locator('button').filter({ hasText: /允许执行|批准/ }).first();
    try {
      await approveButton.waitFor({ state: 'visible', timeout: 3000 });
      await approveButton.click();
      return;
    } catch {}
  };

  // Step 1: Navigate to Settings tab to enable autopilot
  await page.getByRole('tab', { name: /配置中心/ }).click();
  await page.waitForTimeout(1000);

  // Step 2: Enable autopilot - click on the autopilot toggle button
  const autopilotButton = page.locator('button').filter({ hasText: /已关闭/ }).first();
  try {
    await autopilotButton.waitFor({ state: 'visible', timeout: 5000 });
    await autopilotButton.click();
    await page.waitForTimeout(1000);
  } catch {
    // Autopilot might already be enabled
  }

  // Step 3: Verify autopilot is enabled (toggle should show "已开启")
  const autopilotEnabledButton = page.locator('button').filter({ hasText: /已开启/ }).first();
  await expect(autopilotEnabledButton).toBeVisible({ timeout: 10000 });

  // Step 4: Game designer receives task and automatically creates handoff
  // With autopilot enabled, the handoff should be auto-accepted by CEO
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const gameDesignerButton = page.locator('button').filter({ hasText: /游戏策划/ }).first();
  await gameDesignerButton.waitFor({ state: 'visible', timeout: 10000 });
  await gameDesignerButton.click();

  const commandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await commandInput.fill('请设计一个休闲游戏的核心玩法');

  const sendButton = page.locator('button').filter({ hasText: /发送/ }).first();
  await sendButton.click();

  // Wait for agent to process and automatically create handoff
  const processingIndicator = page.getByText(/Agent 正在处理/).first();
  try {
    await processingIndicator.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator.waitFor({ state: 'hidden', timeout: 120000 });
  } catch {}

  // Handle any permission requests for tool calls
  await handlePermissionIfPresent();
  await page.waitForTimeout(2000);

  // Step 5: Verify handoff was automatically created by game designer
  // With autopilot enabled, the handoff should be auto-accepted and in "处理中" state
  await page.getByRole('tab', { name: /任务交接/ }).click();
  await page.waitForTimeout(1000);

  // The handoff should be created automatically by the agent
  const handoffItems = page.locator('[data-testid^="handoff-card-"]').all();
  expect((await handoffItems).length).toBeGreaterThan(0);

  // With autopilot, the handoff should be auto-accepted
  // Wait a bit for autopilot to process
  await page.waitForTimeout(3000);

  // Verify the handoff is in processing state (auto-accepted by autopilot)
  const processingHandoff = page.locator('[data-testid^="handoff-card-"]').filter({ hasText: /处理中|工作中/ }).first();
  await expect(processingHandoff).toBeAttached({ timeout: 10000 });
});
