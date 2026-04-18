import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const mockAdminBase = process.env.CODEBUDDY_MOCK_ADMIN_URL || 'http://localhost:3001';
const studioApiBase = process.env.STUDIO_API_BASE || 'http://localhost:3000';
const starOfficeApiBase = process.env.STAR_OFFICE_API_BASE || 'http://localhost:19000';

// ─── Test-Driven Mock Control (per-agent routing) ───
// Mock server routes by (projectId, agentRole) from HTTP headers injected by agent-manager.
// Each agent's queue is independent — no FIFO cross-agent interference.

/**
 * Queue a mock response for a specific (projectId, agentRole).
 * When that agent calls /chat/completions, the mock matches by its identity headers.
 */
const setMockExpectation = async (
  projectId: string,
  agentRole: string,
  response: {
    content?: string;
    toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> | string }>;
    matcher?: Record<string, unknown>;
  }
) => {
  const resp = await fetch(`${mockAdminBase}/mock/expect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, agentRole, response })
  });
  if (!resp.ok) {
    throw new Error(`failed to set mock expectation for ${projectId}:${agentRole}: ${resp.status} ${await resp.text()}`);
  }
  const result = await resp.json() as { expectation: { id: string; queueSize: number; agent: string } };
  console.log(`[mock-expect] queued for ${result.expectation.agent} id=${result.expectation.id}, depth=${result.expectation.queueSize}`);
};

/** Convenience: queue a create_handoff tool call response for a specific agent */
const expectHandoff = (projectId: string, agentRole: string, toAgent: string) =>
  setMockExpectation(projectId, agentRole, {
    content: `${agentRole} 任务完成，正在移交给 ${toAgent}。`,
    toolCalls: [{
      name: 'create_handoff',
      arguments: { to_agent_id: toAgent, title: `${agentRole} → ${toAgent} 任务完成交接`, description: `任务已完成，移交继续处理`, priority: 'high' }
    }]
  });

/** Convenience: queue a plain text completion (no tool calls) for a specific agent */
const expectText = (projectId: string, agentRole: string, text = '任务已完成。') =>
  setMockExpectation(projectId, agentRole, { content: text });

test.beforeEach(async () => {
  // Reset mock server state
  const resetResp = await fetch(`${mockAdminBase}/__admin/reset`, { method: 'POST' });
  if (!resetResp.ok) {
    throw new Error(`failed to reset mock server: ${resetResp.status}`);
  }

  // Reset autopilot setting
  const resetSettingsResp = await fetch(`${studioApiBase}/api/projects/default/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autopilot_enabled: false })
  });
  if (!resetSettingsResp.ok && resetSettingsResp.status !== 404) {
    console.warn(`[setup] failed to reset settings: ${resetSettingsResp.status}`);
  }
});

// ═══════════════════════════════════════════
// Simple UI tests (no mock expectations needed)
// ═══════════════════════════════════════════

test('[UI-001] should load studio overview with connected state', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Game Dev Studio' })).toBeVisible();
  await expect(page.getByText('团队总览', { exact: true })).toBeVisible();
});

test('[UI-002] should switch language to chinese', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'en-US'));
  await page.goto('/');
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('tab', { name: /Overview|团队总览/ })).toBeVisible();
});

test('[UI-003] should toggle autopilot setting', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');
  await page.getByRole('tab', { name: /配置中心/ }).click();
  await expect(page.getByText('自动驾驶模式')).toBeVisible();
  const toggleDisabled = page.getByRole('button', { name: /已关闭/ });
  await expect(toggleDisabled).toBeVisible();
  await toggleDisabled.click();
  await expect(page.getByRole('button', { name: /已开启/ })).toBeVisible();
});

test('[UI-004] should create and switch to a new project', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');
  const projectName = `demo-ui-${Date.now()}`;
  await page.getByPlaceholder('新建项目名').fill(projectName);
  await page.getByRole('button', { name: '新建' }).click();
  const select = page.locator('select').first();
  await expect(select.locator(`option[value="${projectName}"]`)).toHaveCount(1);
  await expect(select).toHaveValue(projectName);
});

test('[UI-005] should navigate major tabs', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');
  for (const tab of ['团队建设', '策划案', '任务看板', '任务交接', '配置中心', '游戏成品', '运行日志', '指令中心']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
});

test('[UI-006] should load star-office-ui and keep agent status synced via agents api', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');
  await page.getByRole('tab', { name: /Studio/ }).click();
  await expect(page.locator('iframe[title="Star-Office-UI"]')).toBeVisible();
  await expect(page.getByText('Star-Office-UI 加载失败。')).toHaveCount(0);

  const currentProjectId = await page.locator('select').first().inputValue();
  const pauseResp = await fetch(`${studioApiBase}/api/agents/engineer/pause?projectId=${encodeURIComponent(currentProjectId)}`, { method: 'POST' });
  if (!pauseResp.ok) throw new Error(`failed to pause engineer: ${pauseResp.status}`);

  const agentsResp = await fetch(`${studioApiBase}/api/agents?projectId=${encodeURIComponent(currentProjectId)}`);
  if (!agentsResp.ok) throw new Error(`failed to get agents: ${agentsResp.status}`);
  const agentsData = await agentsResp.json() as { agents: Array<{ id: string; state: { status: string } }> };
  const engineer = agentsData.agents.find(a => a.id === 'engineer');
  expect(engineer?.state.status).toBe('paused');

  const starResp = await fetch(`${starOfficeApiBase}/agents`);
  if (!starResp.ok) throw new Error(`failed star-office agents: ${starResp.status}`);
  const starAgents = await starResp.json() as Array<{ agentId: string }>;
  expect(starAgents.length).toBeGreaterThan(0);
  expect(typeof starAgents[0].agentId).toBe('string');
});

// ═══════════════════════════════════════════
// Shared: Full workflow — target-state-driven event loop
// Used by both UI-007 (manual) and UI-008 (autopilot)
// ═══════════════════════════════════════════

interface WorkflowOptions {
  /** Test identifier for log prefixes */
  testId: string;
  /** Enable autopilot mode (auto-accepts handoffs internally) */
  autopilot: boolean;
  /** Game name to assert in final verification */
  gameName: string;
}

const runFullWorkflowTest = async (
  page: Parameters<typeof test>[1],
  opts: WorkflowOptions
) => {
  const LOOP_TIMEOUT_MS = parseInt(process.env.UI_TEST_LOOP_TIMEOUT_MS || '600000', 10);
  test.setTimeout(LOOP_TIMEOUT_MS + 30000);

  const debugPrefix = `[${opts.testId}]`;
  const log = (step: string, extra?: Record<string, unknown>) => {
    let payload = '';
    if (extra) try { payload = ` ${JSON.stringify(extra)}` } catch { payload = ` ${String(extra)}` }
    process.stderr.write(`${debugPrefix} ${new Date().toISOString()} ${step}${payload}\n`);
  };

  // ── Helper: switch to a tab by testid, with logging ──
  const switchTab = async (tabId: string): Promise<boolean> => {
    try {
      const tab = page.getByTestId(tabId);
      if (await tab.count() === 0) {
        log(`switchTab:not-found`, { tabId });
        return false;
      }
      await tab.click({ timeout: 2000, force: true });
      await page.waitForTimeout(200);
      log(`switchTab:ok`, { tabId });
      return true;
    } catch (e) {
      log(`switchTab:failed`, { tabId, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  // ── Helper: click permission allow button if visible (non-blocking, UI only) ──
  // Permission cards are rendered as a global banner ABOVE tab panels — visible on any tab.
  const tryClickPermission = async (): Promise<boolean> => {
    try {
      // Check for permission cards first
      const permCards = page.getByTestId('permission-card');
      const cardCount = await permCards.count();
      log(`tryClickPermission:card-count`, { cardCount });

      // Check for allow buttons
      const btns = page.getByTestId('permission-allow-btn');
      const btnCount = await btns.count();
      log(`tryClickPermission:btn-count`, { btnCount });

      if (btnCount === 0) return false;

      // Click the first visible allow button
      for (let i = 0; i < btnCount; i++) {
        const btn = btns.nth(i);
        const visible = await btn.isVisible().catch(() => false);
        log(`tryClickPermission:btn-${i}`, { visible });
        if (visible) {
          await btn.click({ timeout: 2000, force: true });
          log('tryClickPermission:clicked', { index: i });
          return true;
        }
      }
      return false;
    } catch (e) {
      log('tryClickPermission:error', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  // ── Helper: accept any pending handoff (manual mode, non-blocking) ──
  // Switches to handoffs tab itself
  const tryAcceptAnyPending = async (): Promise<boolean> => {
    try {
      await switchTab('tab-handoffs');
      const pendingCards = page.locator(
        `[data-testid^="handoff-card-"][data-handoff-status="pending"]`
      );
      const count = await pendingCards.count();
      log(`tryAcceptAnyPending:pending-count`, { count });
      if (count === 0) return false;
      const card = pendingCards.first();
      const toRole = await card.getAttribute('data-agent-to');
      log(`tryAcceptAnyPending:expanding`, { toRole: toRole || 'unknown' });
      await card.getByTestId('handoff-header').click({ timeout: 1000, force: true });
      await page.waitForTimeout(300);
      const acceptBtn = card.getByTestId('handoff-accept-btn');
      const acceptVisible = await acceptBtn.isVisible().catch(() => false);
      log(`tryAcceptAnyPending:accept-visible`, { toRole: toRole || 'unknown', acceptVisible });
      if (!acceptVisible) return false;
      await acceptBtn.click({ timeout: 1000, force: true });
      log(`tryAcceptAnyPending:clicked`, { toRole: toRole || 'unknown' });
      return true;
    } catch (e) {
      log('tryAcceptAnyPending:error', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  // ── Helper: confirm any accepted handoff (manual mode, non-blocking) ──
  // Switches to handoffs tab itself
  const tryConfirmAnyAccepted = async (): Promise<boolean> => {
    try {
      await switchTab('tab-handoffs');
      const acceptedCards = page.locator(
        `[data-testid^="handoff-card-"][data-handoff-status="accepted"]`
      );
      const count = await acceptedCards.count();
      log(`tryConfirmAnyAccepted:accepted-count`, { count });
      if (count === 0) return false;
      // Pick the latest accepted card
      const card = acceptedCards.nth(count - 1);
      const toRole = await card.getAttribute('data-agent-to');
      log(`tryConfirmAnyAccepted:expanding`, { toRole: toRole || 'unknown' });
      // Expand the card first to reveal confirm button
      await card.getByTestId('handoff-header').click({ timeout: 1000, force: true });
      await page.waitForTimeout(300);
      const confirmBtn = card.getByTestId('handoff-confirm-btn');
      const confirmVisible = await confirmBtn.isVisible().catch(() => false);
      log(`tryConfirmAnyAccepted:confirm-visible`, { toRole: toRole || 'unknown', confirmVisible });
      if (!confirmVisible) return false;
      await confirmBtn.click({ timeout: 1000, force: true });
      log(`tryConfirmAnyAccepted:clicked`, { toRole: toRole || 'unknown' });
      return true;
    } catch (e) {
      log('tryConfirmAnyAccepted:error', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const createProjectViaApi = async (id: string) => {
    const r = await fetch(`${studioApiBase}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id }) });
    if (r.status !== 409 && !r.ok) throw new Error(`create project: ${r.status}`);
  };
  const switchProjectViaApi = async (id: string) => {
    const r = await fetch(`${studioApiBase}/api/projects/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toProjectId: id }) });
    if (!r.ok) throw new Error(`switch project: ${r.status}`);
  };

  // ── Setup: create project ──
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');

  const projectId = `${opts.testId.toLowerCase()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await page.getByTestId('project-name-input').fill(projectId);
  const createBtn = page.getByTestId('project-create-btn');
  await expect(createBtn).toBeVisible({ timeout: 10000 });
  try { await createBtn.click({ timeout: 15000 }); } catch {
    await createProjectViaApi(projectId);
    await switchProjectViaApi(projectId);
    await page.reload();
  }
  const sel = page.getByTestId('project-select');
  await expect(sel).toHaveValue(projectId, { timeout: 15000 });

  // ── Configure autopilot ──
  await page.getByTestId('tab-settings').click();
  if (opts.autopilot) {
    const autoOff = page.getByRole('button', { name: /已关闭|Disabled/ });
    if (await autoOff.count()) await autoOff.click();
    await expect(page.getByRole('button', { name: /已开启|Enabled/ })).toBeVisible();
    log('setup:autopilot-enabled');
  } else {
    const autoOn = page.getByRole('button', { name: /已开启|Enabled/ });
    if (await autoOn.count()) await autoOn.click();
    await expect(page.getByRole('button', { name: /已关闭|Disabled/ })).toBeVisible();
    log('setup:autopilot-disabled');
  }

  // ── Queue ALL mocks ──
  // Both modes: same mocks — confirm triggers sendMessage which triggers LLM call
  // Manual: game_designer sends → LLM → create_handoff(to=ceo)
  //         confirm ceo → sendMessage → LLM → create_handoff(to=architect)
  //         confirm architect → sendMessage → LLM → create_handoff(to=engineer)
  //         confirm engineer → sendMessage → LLM → submit_proposal / submit_game / save_memory / text
  // Autopilot: same chain but auto-dispatched
  log('mocks:queueing-all');
  await expectHandoff(projectId, 'game_designer', 'ceo');
  await expectHandoff(projectId, 'ceo', 'architect');
  await expectHandoff(projectId, 'architect', 'engineer');
  await setMockExpectation(projectId, 'engineer', {
    content: '提案已提交。',
    toolCalls: [{ name: 'submit_proposal', arguments: { type: 'game_design', title: '最终技术方案', content: '# 技术架构方案' } }]
  });
  await setMockExpectation(projectId, 'engineer', {
    content: '游戏已提交。',
    toolCalls: [{ name: 'submit_game', arguments: { name: opts.gameName, html_content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${opts.gameName}</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#eee}</style></head><body><div id="app"><h1>🎮 ${opts.gameName}</h1><p>这是一个由多Agent协作开发的游戏。</p></div></body></html>` } }]
  });
  await setMockExpectation(projectId, 'engineer', {
    content: '记忆已保存。',
    toolCalls: [{ name: 'save_memory', arguments: { category: 'achievement', content: '项目完成' } }]
  });
  await expectText(projectId, 'engineer', '开发任务全部完成。');
  log('mocks:all-queued');

  // ── Send the initial command to game_designer ──
  await page.getByTestId('tab-commands').click();
  await page.waitForTimeout(500);
  const gdButton = page.locator('button').filter({ hasText: /游戏策划/ }).first();
  await gdButton.click();
  const textarea = page.locator('textarea[placeholder*="下达指令"]').first();
  await textarea.fill('请设计一个RPG游戏的核心玩法，包括战斗系统和角色成长机制');
  await page.locator('button').filter({ hasText: /发送/ }).first().click();
  log('command-sent:game-designer');

  // ════════════════════════════════════════════════
  // MAIN EVENT LOOP
  // Each iteration: check permission → accept handoff → confirm handoff → count state
  // All operations are non-blocking (try/catch + short timeout)
  // Sleep 1s between iterations
  // Exit when ≥3 handoff cards AND ≥1 game
  // ════════════════════════════════════════════════
  const deadline = Date.now() + LOOP_TIMEOUT_MS;
  let loopIter = 0;

  log('loop:enter', { autopilot: opts.autopilot, timeoutSec: LOOP_TIMEOUT_MS / 1000 });

  while (Date.now() < deadline) {
    loopIter++;
    const elapsed = Math.round(((Date.now() - deadline) + LOOP_TIMEOUT_MS) / 1000);

    // ── Iteration header ──
    log(`loop:start`, { iter: loopIter, elapsedSec: elapsed });

    // ── Step 1: Check permission (global banner, no tab switch needed) ──
    log(`step1:check-permission`);
    try {
      const clicked = await tryClickPermission();
      log(`step1:permission-result`, { clicked });
    } catch (e) {
      log(`step1:permission-error`, { error: e instanceof Error ? e.message : String(e) });
    }

    // ── Step 2: Manual mode — accept/confirm handoffs ──
    if (!opts.autopilot) {
      log(`step2:check-pending-handoffs`);
      try {
        const accepted = await tryAcceptAnyPending();
        log(`step2:accept-result`, { accepted });
      } catch (e) {
        log(`step2:accept-error`, { error: e instanceof Error ? e.message : String(e) });
      }
      log(`step2:check-accepted-handoffs`);
      try {
        const confirmed = await tryConfirmAnyAccepted();
        log(`step2:confirm-result`, { confirmed });
      } catch (e) {
        log(`step2:confirm-error`, { error: e instanceof Error ? e.message : String(e) });
      }
    } else {
      log(`step2:skip-autopilot`);
    }

    // ── Step 3: Count handoff cards (helper switches tab) ──
    let cardCount = 0;
    try {
      await switchTab('tab-handoffs');
      cardCount = await page.locator('[data-testid^="handoff-card-"]').count();
      log(`step3:handoff-count`, { cardCount });
    } catch (e) {
      log(`step3:handoff-count-error`, { error: e instanceof Error ? e.message : String(e) });
    }

    // ── Step 4: Count games (helper switches tab) ──
    let gameCount = 0;
    try {
      await switchTab('tab-games');
      const gameCards = page.locator('[data-testid^="game-card-"]');
      gameCount = await gameCards.count();
      log(`step4:game-count`, { gameCount });
    } catch (e) {
      log(`step4:game-count-error`, { error: e instanceof Error ? e.message : String(e) });
    }

    // ── Step 5: Check target state ──
    // 3 handoffs: game_designer→ceo, ceo→architect, architect→engineer
    // engineer does submit_proposal/submit_game/save_memory instead of handoff
    const TARGET_CARDS = 3;
    log(`step5:check-target`, { cardCount, gameCount, target: { cards: TARGET_CARDS, games: 1 } });
    if (cardCount >= TARGET_CARDS && gameCount >= 1) {
      log(`step5:target-reached`, { cardCount, gameCount });

      // Final verification with explicit assertions
      await switchTab('tab-handoffs');
      await page.waitForTimeout(500);
      const finalCards = page.locator('[data-testid^="handoff-card-"]');
      const fc = await finalCards.count();
      expect(fc).toBeGreaterThanOrEqual(TARGET_CARDS);

      await switchTab('tab-games');
      await page.waitForTimeout(500);
      const gameItems = page.locator('[data-testid^="game-card-"]');
      const gc = await gameItems.count();
      expect(gc).toBeGreaterThanOrEqual(1);
      await expect(gameItems.first()).toHaveAttribute('data-game-name', new RegExp(opts.gameName));

      log(`${opts.testId} COMPLETE ✅`, { totalCards: fc, totalGames: gc, elapsedSec: elapsed });
      return;
    }

    // Sleep 1s before next iteration
    log(`loop:end-sleep`);
    await page.waitForTimeout(1000);
  }

  throw new Error(`[${opts.testId}] Event loop timed out after ${LOOP_TIMEOUT_MS / 1000}s without reaching target state`);
};

// ═══════════════════════════════════════════
// UI-007: Full workflow — MANUAL mode (no autopilot)
// Handoffs are accepted/confirmed manually in the event loop.
// ═══════════════════════════════════════════

test('[UI-007] should complete full workflow: game designer -> CEO -> architect -> engineer (manual)', async ({ page }) => {
  await runFullWorkflowTest(page, {
    testId: 'UI-007',
    autopilot: false,
    gameName: '测试游戏',
  });
});

// ═══════════════════════════════════════════
// UI-008: Full workflow — AUTOPILOT mode
// Backend auto-accepts handoffs; test only handles permissions + state check.
// ═══════════════════════════════════════════

test('[UI-008] should complete full workflow with autopilot and auto-handoff', async ({ page }) => {
  await runFullWorkflowTest(page, {
    testId: 'UI-008',
    autopilot: true,
    gameName: '休闲游戏',
  });
});

test('[UI-009] should manually create a proposal via UI', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  await page.goto('/');

  // 切换到提案标签页
  await page.getByRole('tab', { name: /策划案/ }).click();
  await expect(page.getByRole('heading', { name: /策划案/ })).toBeVisible();

  // 记录初始提案数量
  const initialCount = await page.locator('[data-testid^="proposal-item-"]').count();

  // 点击创建提案按钮
  await page.getByTestId('create-proposal-btn').click();
  await expect(page.getByTestId('proposal-type-select')).toBeVisible();

  // 填写表单
  await page.getByTestId('proposal-type-select').selectOption('tech_arch');
  await page.getByTestId('proposal-author-select').selectOption('architect');
  await page.getByTestId('proposal-title-input').fill('测试技术架构提案');
  await page.getByTestId('proposal-content-textarea').fill('这是一个通过 UI 手动创建的测试提案。');

  // 提交表单
  await page.getByTestId('proposal-submit-btn').click();
  await expect(page.getByTestId('proposal-submit-btn')).toBeDisabled(); // 提交期间禁用
  await expect(page.getByTestId('proposal-type-select')).not.toBeVisible(); // 对话框应关闭

  // 等待提案列表更新（通过 SSE 事件）
  await page.waitForTimeout(1000);

  // 验证提案数量增加
  const finalCount = await page.locator('[data-testid^="proposal-item-"]').count();
  expect(finalCount).toBeGreaterThan(initialCount);

  // 验证新提案出现在列表中（通过标题）
  await expect(page.getByText('测试技术架构提案')).toBeVisible();
});
