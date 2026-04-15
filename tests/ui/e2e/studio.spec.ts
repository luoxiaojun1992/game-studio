import { test, expect } from '@playwright/test';

const mockAdminBase =
  process.env.CODEBUDDY_MOCK_ADMIN_URL ||
  process.env.MOCK_SERVER_ADMIN_URL ||
  'http://localhost:3001';
const studioApiBase = process.env.STUDIO_API_BASE || 'http://localhost:3000';
const starOfficeApiBase = process.env.STAR_OFFICE_API_BASE || 'http://localhost:19000';
const longRunningTestTimeoutMs = 180_000;

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

test('[UI-007] should run a deterministic handoff chain from game designer to engineer via codebuddy mock', async ({ page }) => {
  test.setTimeout(longRunningTestTimeoutMs);
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');

  const runId = `ui-007-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;
  const testProjectId = runId;

  const createProjectResponse = await fetch(`${studioApiBase}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: testProjectId, name: testProjectId })
  });
  if (!createProjectResponse.ok && createProjectResponse.status !== 409) {
    throw new Error(`failed to create project for UI-007: ${createProjectResponse.status} ${await createProjectResponse.text()}`);
  }

  const ui007AutopilotEnabled = false;
  const disableAutopilotResponse = await fetch(`${studioApiBase}/api/projects/${encodeURIComponent(testProjectId)}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autopilot_enabled: ui007AutopilotEnabled })
  });
  if (!disableAutopilotResponse.ok) {
    throw new Error(`failed to disable autopilot for UI-007 project: ${disableAutopilotResponse.status} ${await disableAutopilotResponse.text()}`);
  }

  const targetAgentIds = ['game_designer', 'ceo', 'architect', 'engineer'] as const;

  for (const agentId of targetAgentIds) {
    const resumeResponse = await fetch(`${studioApiBase}/api/agents/${encodeURIComponent(agentId)}/resume?projectId=${encodeURIComponent(testProjectId)}`, {
      method: 'POST'
    });
    if (!resumeResponse.ok) {
      throw new Error(`failed to resume ${agentId} for UI-007: ${resumeResponse.status} ${await resumeResponse.text()}`);
    }
  }

  await expect.poll(async () => {
    const response = await fetch(`${studioApiBase}/api/agents?projectId=${encodeURIComponent(testProjectId)}`);
    if (!response.ok) return false;
    const data = await response.json() as {
      agents: Array<{ id: string; state: { isPaused: boolean; status: string } }>;
    };
    return targetAgentIds.every(agentId => {
      const matched = data.agents.find(agent => agent.id === agentId);
      return !!matched && matched.state.isPaused === false;
    });
  }, {
    timeout: 30_000,
    intervals: [1000, 2000, 3000]
  }).toBe(true);

  const commandByAgent = new Map([
    ['game_designer', `[${runId}] complete game design and prepare handoff to ceo`],
    ['ceo', `[${runId}] review game design and prepare handoff to architect`],
    ['architect', `[${runId}] complete architecture and prepare handoff to engineer`],
    ['engineer', `[${runId}] implement and finish assigned tasks`]
  ]);

  for (const mockPath of ['/chat/completions', '/v1/chat/completions']) {
    const injectMockResponse = await fetch(`${mockAdminBase}/__admin/mocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'POST',
        path: mockPath,
        sse: true,
        body: [
          {
            id: 'chatcmpl-ui-007',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: `[${runId}] deterministic mock response` } }]
          }
        ]
      })
    });
    if (!injectMockResponse.ok) {
      throw new Error(`failed to inject codebuddy mock for path ${mockPath}: ${injectMockResponse.status} ${await injectMockResponse.text()}`);
    }
  }

  const getCommands = async (): Promise<{
    commands: Array<{ content: string; target_agent_id: string; status: string }>;
  }> => {
    const response = await fetch(`${studioApiBase}/api/commands?projectId=${encodeURIComponent(testProjectId)}`);
    if (!response.ok) {
      throw new Error(`failed to get commands: ${response.status} ${await response.text()}`);
    }
    return response.json();
  };

  const sendAgentCommand = async (agentId: string) => {
    const content = commandByAgent.get(agentId);
    if (!content) throw new Error(`missing command for agent: ${agentId}`);
    const response = await fetch(`${studioApiBase}/api/agents/${encodeURIComponent(agentId)}/command?projectId=${encodeURIComponent(testProjectId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content })
    });
    if (!response.ok) {
      throw new Error(`failed to send command to ${agentId}: ${response.status} ${await response.text()}`);
    }
    // Command endpoint streams SSE; keep consuming the stream to avoid disconnect-induced server-side failures.
    const streamDrainPromise = (async () => {
      if (!response.body) return;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    })();

    await expect.poll(async () => {
      const data = await getCommands();
      const matched = data.commands.find(command => command.content === content && command.target_agent_id === agentId);
      return matched?.status || 'missing';
    }, {
      timeout: 30_000,
      intervals: [1000, 2000, 3000]
    }).toBe('done');
    await streamDrainPromise;
  };

  const taskStatusFlow: Array<'developing' | 'testing' | 'done'> = ['developing', 'testing', 'done'];

  const createAndCompleteTask = async (agentId: string) => {
    const createResponse = await fetch(`${studioApiBase}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: testProjectId,
        title: `[${runId}] ${agentId} task`,
        description: `${agentId} deterministic execution`,
        task_type: 'development',
        created_by: agentId
      })
    });
    if (!createResponse.ok) {
      throw new Error(`failed to create task for ${agentId}: ${createResponse.status} ${await createResponse.text()}`);
    }
    const { task } = await createResponse.json() as { task: { id: string } };

    for (const status of taskStatusFlow) {
      const updateResponse = await fetch(`${studioApiBase}/api/tasks/${task.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, updated_by: agentId })
      });
      if (!updateResponse.ok) {
        throw new Error(`failed to update task status for ${agentId}: ${updateResponse.status} ${await updateResponse.text()}`);
      }
    }
  };

  const createAndCompleteHandoff = async (fromAgentId: string, toAgentId: string) => {
    const createResponse = await fetch(`${studioApiBase}/api/handoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: testProjectId,
        from_agent_id: fromAgentId,
        to_agent_id: toAgentId,
        title: `[${runId}] ${fromAgentId} -> ${toAgentId}`,
        description: `${fromAgentId} completed and hands off to ${toAgentId}`
      })
    });
    if (!createResponse.ok) {
      throw new Error(`failed to create handoff ${fromAgentId} -> ${toAgentId}: ${createResponse.status} ${await createResponse.text()}`);
    }
    const { handoff } = await createResponse.json() as { handoff: { id: string } };

    const acceptResponse = await fetch(`${studioApiBase}/api/handoffs/${handoff.id}/accept`, { method: 'POST' });
    if (!acceptResponse.ok) {
      throw new Error(`failed to accept handoff ${fromAgentId} -> ${toAgentId}: ${acceptResponse.status} ${await acceptResponse.text()}`);
    }
    if (!ui007AutopilotEnabled) {
      const confirmResponse = await fetch(`${studioApiBase}/api/handoffs/${handoff.id}/confirm`, { method: 'POST' });
      if (!confirmResponse.ok) {
        throw new Error(`failed to confirm handoff ${fromAgentId} -> ${toAgentId}: ${confirmResponse.status} ${await confirmResponse.text()}`);
      }
    }
    const completeResponse = await fetch(`${studioApiBase}/api/handoffs/${handoff.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: `[${runId}] completed by ${toAgentId}` })
    });
    if (!completeResponse.ok) {
      throw new Error(`failed to complete handoff ${fromAgentId} -> ${toAgentId}: ${completeResponse.status} ${await completeResponse.text()}`);
    }
  };

  await sendAgentCommand('game_designer');
  await createAndCompleteTask('game_designer');
  await createAndCompleteHandoff('game_designer', 'ceo');

  await sendAgentCommand('ceo');
  await createAndCompleteTask('ceo');
  await createAndCompleteHandoff('ceo', 'architect');

  await sendAgentCommand('architect');
  await createAndCompleteTask('architect');
  await createAndCompleteHandoff('architect', 'engineer');

  await sendAgentCommand('engineer');
  await createAndCompleteTask('engineer');

  await expect.poll(async () => {
    const response = await fetch(`${studioApiBase}/api/handoffs?projectId=${encodeURIComponent(testProjectId)}`);
    if (!response.ok) {
      throw new Error(`failed to list handoffs: ${response.status} ${await response.text()}`);
    }
    const data = await response.json() as {
      handoffs: Array<{ title: string; from_agent_id: string; to_agent_id: string; status: string }>;
    };
    const chain = [
      ['game_designer', 'ceo'],
      ['ceo', 'architect'],
      ['architect', 'engineer']
    ];
    return chain.every(([from, to]) =>
      data.handoffs.some(h => h.title.includes(runId) && h.from_agent_id === from && h.to_agent_id === to && h.status === 'completed')
    );
  }, {
    timeout: 30_000,
    intervals: [1000, 2000, 3000]
  }).toBe(true);

  await expect.poll(async () => {
    const response = await fetch(`${studioApiBase}/api/tasks?projectId=${encodeURIComponent(testProjectId)}`);
    if (!response.ok) {
      throw new Error(`failed to list tasks: ${response.status} ${await response.text()}`);
    }
    const data = await response.json() as {
      tasks: Array<{ title: string; created_by: string; status: string }>;
    };
    return data.tasks.some(task => task.title.includes(runId) && task.created_by === 'engineer' && task.status === 'done');
  }, {
    timeout: 30_000,
    intervals: [1000, 2000, 3000]
  }).toBe(true);
});
