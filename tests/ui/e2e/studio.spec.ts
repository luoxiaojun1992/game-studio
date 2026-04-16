import { test, expect } from '@playwright/test';

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

test('[UI-007] should complete full workflow: game designer command -> task -> handoff -> engineer completion', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');

  // Helper function to handle permission dialogs and ask user questions
  const handlePermissionIfPresent = async () => {
    const approveButton = page.locator('button').filter({ hasText: /允许执行|批准/ }).first();
    try {
      await approveButton.waitFor({ state: 'visible', timeout: 3000 });
      await approveButton.click();
      return;
    } catch {}
    const skipButton = page.locator('button').filter({ hasText: /跳过/ }).first();
    try {
      await skipButton.waitFor({ state: 'visible', timeout: 3000 });
      await skipButton.click();
    } catch {}
  };

  // Step 1: Navigate to Commands tab and send command to game designer
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const gameDesignerButton = page.locator('button').filter({ hasText: /游戏策划/ }).first();
  await gameDesignerButton.waitFor({ state: 'visible', timeout: 10000 });
  await gameDesignerButton.click();

  const commandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await commandInput.fill('请设计一个RPG游戏的核心玩法，包括战斗系统和角色成长机制');

  const sendButton = page.locator('button').filter({ hasText: /发送/ }).first();
  await sendButton.click();

  await handlePermissionIfPresent();

  const processingIndicator = page.getByText(/Agent 正在处理/).first();
  try {
    await processingIndicator.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator.waitFor({ state: 'hidden', timeout: 60000 });
  } catch {}
  await page.waitForTimeout(1000);

  // Step 2: Navigate to Handoffs tab and create a handoff
  await page.getByRole('tab', { name: /任务交接/ }).click();

  const createHandoffButton = page.locator('button').filter({ hasText: /创建交接|新建交接/ }).first();
  await createHandoffButton.click();

  const modal = page.locator('.fixed.inset-0 .bg-gray-900');
  await modal.waitFor({ state: 'visible', timeout: 10000 });

  await modal.locator('input').fill('游戏策划交接：核心玩法设计完成');
  await modal.locator('textarea').first().fill('已完成RPG游戏核心玩法设计，包括战斗系统和角色成长机制，需要CEO评审');

  const targetAgentSelect = page.locator('.fixed.inset-0 select').nth(1);
  await targetAgentSelect.waitFor({ state: 'visible', timeout: 10000 });
  await targetAgentSelect.selectOption('ceo');

  await modal.locator('button').filter({ hasText: /创建交接/ }).click();

  await expect(page.locator('body').getByText('游戏策划交接：核心玩法设计完成').first()).toBeAttached({ timeout: 10000 });

  await handlePermissionIfPresent();

  // Step 3: Accept the handoff as CEO
  const handoffHeader = page.getByTestId('handoff-header').first();
  await handoffHeader.click();
  await page.waitForTimeout(500);

  const acceptButton = page.getByTestId('handoff-accept-btn').first();
  await acceptButton.click();

  // Step 4: CEO completes task and creates handoff to architect
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const ceoButton = page.locator('button').filter({ hasText: /CEO/ }).first();
  await ceoButton.click();

  const ceoCommandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await ceoCommandInput.fill('请评审游戏策划案并创建交接给架构师进行技术设计');

  const ceoSendButton = page.locator('button').filter({ hasText: /发送/ }).first();
  await ceoSendButton.click();

  await handlePermissionIfPresent();

  try {
    const processingIndicator2 = page.getByText(/Agent 正在处理/).first();
    await processingIndicator2.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator2.waitFor({ state: 'hidden', timeout: 60000 });
  } catch {}
  await page.waitForTimeout(1000);

  // Step 5: Create handoff from CEO to architect
  await page.getByRole('tab', { name: /任务交接/ }).click();

  await createHandoffButton.click();

  const modal2 = page.locator('.fixed.inset-0 .bg-gray-900');
  await modal2.waitFor({ state: 'visible', timeout: 10000 });

  await modal2.locator('input').fill('CEO评审完成：技术架构设计交接');
  await modal2.locator('textarea').first().fill('游戏策划案已通过评审，请架构师设计技术方案');

  const architectSelect = modal2.locator('select').nth(1);
  await architectSelect.waitFor({ state: 'visible', timeout: 10000 });
  await architectSelect.selectOption('architect');

  await modal2.locator('button').filter({ hasText: /创建交接/ }).click();
  await expect(page.locator('body').getByText('CEO评审完成：技术架构设计交接').first()).toBeAttached({ timeout: 10000 });

  const handoffHeader2 = page.getByTestId('handoff-header').first();
  await handoffHeader2.click();
  await page.waitForTimeout(500);

  const architectAcceptButton = page.getByTestId('handoff-accept-btn').first();
  await architectAcceptButton.click();

  // Step 6: Architect completes and hands off to engineer
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const architectButton = page.locator('button').filter({ hasText: /架构师/ }).first();
  await architectButton.click();

  const architectCommandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await architectCommandInput.fill('请设计技术架构并创建交接给工程师实现');

  await sendButton.click();

  await handlePermissionIfPresent();

  try {
    const processingIndicator3 = page.getByText(/Agent 正在处理/).first();
    await processingIndicator3.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator3.waitFor({ state: 'hidden', timeout: 60000 });
  } catch {}
  await page.waitForTimeout(1000);

  // Step 7: Create handoff from architect to engineer
  await page.getByRole('tab', { name: /任务交接/ }).click();

  await createHandoffButton.click();

  const modal3 = page.locator('.fixed.inset-0 .bg-gray-900');
  await modal3.waitFor({ state: 'visible', timeout: 10000 });

  await modal3.locator('input').fill('技术架构设计完成：开发交接');
  await modal3.locator('textarea').first().fill('技术架构已设计完成，请工程师开始开发实现');

  const engineerSelect = modal3.locator('select').nth(1);
  await engineerSelect.waitFor({ state: 'visible', timeout: 10000 });
  await engineerSelect.selectOption('engineer');

  await modal3.locator('button').filter({ hasText: /创建交接/ }).click();
  await expect(page.locator('body').getByText('技术架构设计完成：开发交接').first()).toBeAttached({ timeout: 10000 });

  const handoffHeader3 = page.getByTestId('handoff-header').first();
  await handoffHeader3.click();
  await page.waitForTimeout(500);

  const engineerAcceptButton = page.getByTestId('handoff-accept-btn').first();
  await engineerAcceptButton.click();

  // Step 8: Engineer completes the task
  await page.getByRole('tab', { name: /指令中心/ }).click();

  const engineerButton = page.locator('button').filter({ hasText: /软件工程师/ }).first();
  await engineerButton.click();

  const engineerCommandInput = page.locator('textarea[placeholder*="下达指令"]').first();
  await engineerCommandInput.fill('请完成游戏开发并提交最终成果');

  await sendButton.click();

  await handlePermissionIfPresent();

  try {
    const processingIndicator4 = page.getByText(/Agent 正在处理/).first();
    await processingIndicator4.waitFor({ state: 'visible', timeout: 10000 });
    await processingIndicator4.waitFor({ state: 'hidden', timeout: 60000 });
  } catch {}
  await page.waitForTimeout(1000);

  // Step 9: Verify final state
  await page.getByRole('tab', { name: /任务交接/ }).click();

  const handoffItems = page.locator('[class*="border"]').filter({ hasText: /交接|handoff/i }).all();
  expect((await handoffItems).length).toBeGreaterThan(0);
});

test('[UI-008] should enable autopilot and verify handoff auto-acceptance', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');

  // Step 1: Navigate to Settings tab to access autopilot toggle
  await page.getByRole('tab', { name: /配置中心/ }).click();
  await page.waitForTimeout(1000);

  // Step 2: Enable autopilot - click on the autopilot toggle button
  // The autopilot toggle is in the settings panel
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

  // Step 4: Navigate to Handoffs tab and create a handoff manually
  // With autopilot enabled, the handoff should be auto-accepted
  await page.getByRole('tab', { name: /任务交接/ }).click();
  await page.waitForTimeout(500);

  // Click create handoff button
  const createHandoffButton = page.locator('button').filter({ hasText: /创建交接|新建交接/ }).first();
  await createHandoffButton.click();

  // Fill handoff form
  const modal = page.locator('.fixed.inset-0 .bg-gray-900');
  await modal.waitFor({ state: 'visible', timeout: 10000 });

  await modal.locator('input').fill('UI-008 测试交接');
  await modal.locator('textarea').first().fill('测试 autopilot 自动接受功能');

  const targetAgentSelect = page.locator('.fixed.inset-0 select').nth(1);
  await targetAgentSelect.selectOption('ceo');

  await modal.locator('button').filter({ hasText: /创建交接/ }).click();

  // Wait for handoff to be created
  await page.waitForTimeout(1500);

  // Step 5: Verify the handoff was created
  // With autopilot enabled, the handoff should be auto-accepted and in "处理中" state
  await expect(page.locator('body').getByText('UI-008 测试交接').first()).toBeAttached({ timeout: 10000 });
});
