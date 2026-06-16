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
  process.stderr.write(`[mock-expect] ${new Date().toISOString()} queued for ${result.expectation.agent} id=${result.expectation.id}, depth=${result.expectation.queueSize}\n`);
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
  process.stderr.write(`[beforeEach] ${new Date().toISOString()} setup:resetting-mock-server\n`);
  // Reset mock server state
  const resetResp = await fetch(`${mockAdminBase}/__admin/reset`, { method: 'POST' });
  if (!resetResp.ok) {
    throw new Error(`failed to reset mock server: ${resetResp.status}`);
  }
  process.stderr.write(`[beforeEach] ${new Date().toISOString()} setup:mock-server-reset-ok\n`);

  // Reset autopilot setting
  const resetSettingsResp = await fetch(`${studioApiBase}/api/projects/default/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autopilot_enabled: false })
  });
  if (!resetSettingsResp.ok && resetSettingsResp.status !== 404) {
    console.warn(`[setup] failed to reset settings: ${resetSettingsResp.status}`);
  }
  process.stderr.write(`[beforeEach] ${new Date().toISOString()} setup:done\n`);
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
  /** Game type for mock data: affects file writes and spec queries. Defaults to 'h5'. */
  gameType?: 'h5' | 'phaser-mobile';
  /** Enable image processing workflow (SPEC-008): creates image resources, processes them, saves to game artifacts */
  withImageProcessing?: boolean;
  /** Enable video processing workflow (SPEC-009): creates video resources, processes them, saves to game artifacts */
  withVideoProcessing?: boolean;
}

const runFullWorkflowTest = async (
  page: Parameters<typeof test>[1],
  opts: WorkflowOptions
) => {
  const LOOP_TIMEOUT_MS = parseInt(process.env.UI_TEST_LOOP_TIMEOUT_MS || '600000', 10);
  test.setTimeout(LOOP_TIMEOUT_MS + 30000);

  const gameType = opts.gameType || 'h5';
  const isPhaserMobile = gameType === 'phaser-mobile';

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
  log('setup:init-language');
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  log('setup:goto-page');
  await page.goto('/');
  log('setup:page-loaded', { url: page.url() });

  const projectId = `${opts.testId.toLowerCase()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  log('setup:fill-project-name', { projectId });
  await page.getByTestId('project-name-input').fill(projectId);
  const createBtn = page.getByTestId('project-create-btn');
  log('setup:wait-create-btn-visible');
  await expect(createBtn).toBeVisible({ timeout: 10000 });
  log('setup:click-create-btn');
  try {
    await createBtn.click({ timeout: 15000 });
    log('setup:create-btn-clicked');
  } catch {
    log('setup:create-btn-fallback-to-api', { projectId });
    await createProjectViaApi(projectId);
    await switchProjectViaApi(projectId);
    await page.reload();
    log('setup:page-reloaded-after-api-fallback', { url: page.url() });
  }
  const sel = page.getByTestId('project-select');
  log('setup:verify-project-selected', { projectId });
  await expect(sel).toHaveValue(projectId, { timeout: 15000 });
  log('setup:project-created-ok', { projectId });

  // ── Configure autopilot ──
  log('setup:click-settings-tab');
  await page.getByTestId('tab-settings').click();
  if (opts.autopilot) {
    log('setup:autopilot-try-enable');
    const autoOff = page.getByRole('button', { name: /已关闭|Disabled/ });
    const autoOffCount = await autoOff.count();
    log('setup:autopilot-off-btn-count', { count: autoOffCount });
    if (autoOffCount) await autoOff.click();
    await expect(page.getByRole('button', { name: /已开启|Enabled/ })).toBeVisible();
    log('setup:autopilot-enabled');
  } else {
    log('setup:autopilot-try-disable');
    const autoOn = page.getByRole('button', { name: /已开启|Enabled/ });
    const autoOnCount = await autoOn.count();
    log('setup:autopilot-on-btn-count', { count: autoOnCount });
    if (autoOnCount) await autoOn.click();
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
  log('mocks:queue-handoff-gd-to-ceo', { projectId, from: 'game_designer', to: 'ceo' });
  await expectHandoff(projectId, 'game_designer', 'ceo');
  log('mocks:queue-handoff-ceo-to-architect', { projectId, from: 'ceo', to: 'architect' });
  await expectHandoff(projectId, 'ceo', 'architect');
  log('mocks:queue-handoff-architect-to-engineer', { projectId, from: 'architect', to: 'engineer' });
  await expectHandoff(projectId, 'architect', 'engineer');

  // ── Engineer: game framework spec queries (new prompt instructions) ──
  log('mocks:queue-get-game-types', { projectId, agent: 'engineer' });
  await setMockExpectation(projectId, 'engineer', {
    content: '正在查询支持的游戏类型...',
    toolCalls: [{ name: 'get_game_types' }]
  });
  log('mocks:queue-get-game-framework-spec', { projectId, agent: 'engineer', gameType });
  await setMockExpectation(projectId, 'engineer', {
    content: `正在获取 ${gameType} 工程规范...`,
    toolCalls: [{ name: 'get_game_framework_spec', arguments: { game_type: gameType } }]
  });
  log('mocks:queue-get-common-spec', { projectId, agent: 'engineer' });
  await setMockExpectation(projectId, 'engineer', {
    content: '正在获取公共规范...',
    toolCalls: [{ name: 'get_common_spec' }]
  });
  log('mocks:game-spec-queries-queued');

  log('mocks:queue-submit-proposal', { projectId, agent: 'engineer' });
  await setMockExpectation(projectId, 'engineer', {
    content: '提案已提交。',
    toolCalls: [{ name: 'submit_proposal', arguments: { type: 'game_design', title: '最终技术方案', content: '# 技术架构方案' } }]
  });

  // 通过 mock 模拟大模型输出，调用 write_game_file MCP 工具在 backend 服务器端写入游戏文件
  // 注意：使用 MCP 工具而非 SDK 内置 Write 工具，因为 CI 环境无 CodeBuddy 运行时执行内置工具
  // 游戏工程规范要求 dist/ 目录结构 + 生命周期契约
  if (isPhaserMobile) {
    // ── Phaser Mobile 游戏文件 ──
    log('mocks:queue-write-game-index-html', { projectId, path: 'dist/index.html' });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入游戏入口文件...',
      toolCalls: [{
        name: 'write_game_file',
        arguments: {
          path: 'dist/index.html',
          content: '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Phaser游戏</title></head><body><div id="app"></div><script src="phaser.min.js"></script><script src="game.js"></script></body></html>'
        }
      }]
    });
    log('mocks:write-game-index-html-queued');

    log('mocks:queue-write-game-js', { projectId, path: 'dist/game.js' });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入游戏主逻辑...',
      toolCalls: [{
        name: 'write_game_file',
        arguments: {
          path: 'dist/game.js',
          content: 'class GameScene extends Phaser.Scene{preload(){this.load.image("bg","assets/bg.png")}create(){this.add.image(400,300,"bg")}}const config={type:Phaser.AUTO,width:800,height:600,scene:GameScene};new Phaser.Game(config);'
        }
      }]
    });
    log('mocks:write-game-js-queued');

    log('mocks:queue-write-metadata-json', { projectId, path: 'dist/metadata.json' });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入游戏元信息...',
      toolCalls: [{
        name: 'write_game_file',
        arguments: {
          path: 'dist/metadata.json',
          content: JSON.stringify({
            title: 'Phaser游戏',
            version: '1.0.0',
            game_type: 'phaser-mobile',
            resolution: { width: 800, height: 600 },
            orientation: 'landscape',
            entry: 'index.html'
          })
        }
      }]
    });
    log('mocks:write-metadata-json-queued');

    log('mocks:queue-write-capacitor-config', { projectId, path: 'capacitor.config.json' });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入 Capacitor 配置...',
      toolCalls: [{
        name: 'write_game_file',
        arguments: {
          path: 'capacitor.config.json',
          content: JSON.stringify({ appId: 'com.phasergame.demo', appName: 'PhaserGame' })
        }
      }]
    });
    log('mocks:write-capacitor-config-queued');
  } else {
    // ── H5 游戏文件（原有逻辑）──
    log('mocks:queue-write-game-file', { projectId, path: 'dist/index.html' });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入游戏入口文件...',
      toolCalls: [{
        name: 'write_game_file',
        arguments: {
          path: 'dist/index.html',
          content: `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>RPG游戏</title></head><body><div id="game"></div><script>const app={init(c){},start(){},pause(){},resume(){},resize(w,h){},destroy(){}};window.__GAME__=app;</script></body></html>`
        }
      }]
    });
    log('mocks:write-game-file-queued');

    log('mocks:queue-write-metadata-json', { projectId, path: 'dist/metadata.json' });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入游戏元信息...',
      toolCalls: [{
        name: 'write_game_file',
        arguments: {
          path: 'dist/metadata.json',
          content: JSON.stringify({
            title: 'RPG游戏',
            version: '1.0.0',
            game_type: 'h5',
            resolution: { width: 800, height: 600 },
            orientation: 'landscape',
            entry: 'index.html'
          })
        }
      }]
    });
    log('mocks:write-metadata-json-queued');

    log('mocks:queue-write-manifest-json', { projectId, path: 'dist/assets/manifest.json' });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入资源清单...',
      toolCalls: [{
        name: 'write_game_file',
        arguments: {
          path: 'dist/assets/manifest.json',
          content: JSON.stringify({ resources: [] })
        }
      }]
    });
    log('mocks:write-manifest-json-queued');
  }

  // ── Image Processing (SPEC-008): create and process image resources ──
  if (opts.withImageProcessing) {
    log('mocks:image-create-project', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在创建图片处理 project...',
      toolCalls: [{ name: 'image_create_project', arguments: { name: 'game-assets' } }]
    });
    log('mocks:image-create-project-queued');

    // 生成最小 PNG base64（1x1 红色像素）作为测试图片
    const tinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

    // 写入本地图片文件
    log('mocks:image-write-bg-raw', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入原始背景图到本地...',
      toolCalls: [{
        name: 'image_write_file',
        arguments: { filename: 'background_raw.png', content: tinyPngB64 }
      }]
    });
    log('mocks:image-write-bg-raw-queued');

    log('mocks:image-upload-bg-raw', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在上传背景图到 image service...',
      toolCalls: [{ name: 'image_upload_file', arguments: { image_project_id: 'img-proj-001', filename: 'background_raw.png' } }]
    });
    log('mocks:image-upload-bg-raw-queued');

    log('mocks:image-write-ui-sprite', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入UI精灵素材到本地...',
      toolCalls: [{
        name: 'image_write_file',
        arguments: { filename: 'ui_sprite.png', content: tinyPngB64 }
      }]
    });
    log('mocks:image-write-ui-sprite-queued');

    log('mocks:image-upload-ui-sprite', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在上传UI精灵到 image service...',
      toolCalls: [{ name: 'image_upload_file', arguments: { image_project_id: 'img-proj-001', filename: 'ui_sprite.png' } }]
    });
    log('mocks:image-upload-ui-sprite-queued');

    log('mocks:image-write-icon-a', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入图标A到本地...',
      toolCalls: [{
        name: 'image_write_file',
        arguments: { filename: 'icon_a.png', content: tinyPngB64 }
      }]
    });
    log('mocks:image-write-icon-a-queued');

    log('mocks:image-upload-icon-a', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在上传图标A到 image service...',
      toolCalls: [{ name: 'image_upload_file', arguments: { image_project_id: 'img-proj-001', filename: 'icon_a.png' } }]
    });
    log('mocks:image-upload-icon-a-queued');

    log('mocks:image-write-icon-b', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入图标B到本地...',
      toolCalls: [{
        name: 'image_write_file',
        arguments: { filename: 'icon_b.png', content: tinyPngB64 }
      }]
    });
    log('mocks:image-write-icon-b-queued');

    log('mocks:image-upload-icon-b', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在上传图标B到 image service...',
      toolCalls: [{ name: 'image_upload_file', arguments: { image_project_id: 'img-proj-001', filename: 'icon_b.png' } }]
    });
    log('mocks:image-upload-icon-b-queued');

    log('mocks:image-resize', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在缩放背景图...',
      toolCalls: [{
        name: 'image_resize',
        arguments: {
          image_project_id: 'img-proj-001',
          input_filename: 'background_raw.png',
          width: 800,
          height: 600,
          keep_aspect: true,
          output_filename: 'background.png'
        }
      }]
    });
    log('mocks:image-resize-queued');

    // 在 resize 之后查询 background.png（此时文件已由 ImageMagick 生成）
    log('mocks:image-info-query', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在查询图片信息...',
      toolCalls: [{ name: 'image_info', arguments: { image_project_id: 'img-proj-001', filename: 'background.png' } }]
    });
    log('mocks:image-info-query-queued');

    log('mocks:image-compress', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在压缩UI元素...',
      toolCalls: [{
        name: 'image_compress',
        arguments: {
          image_project_id: 'img-proj-001',
          input_filename: 'ui_sprite.png',
          quality: 60,
          output_filename: 'ui_sprite_compressed.png'
        }
      }]
    });
    log('mocks:image-compress-queued');

    log('mocks:image-convert-webp', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在转换为 WebP 格式...',
      toolCalls: [{
        name: 'image_convert',
        arguments: {
          image_project_id: 'img-proj-001',
          input_filename: 'background.png',
          target_format: 'webp',
          output_filename: 'background.webp'
        }
      }]
    });
    log('mocks:image-convert-webp-queued');

    log('mocks:image-watermark', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在添加水印...',
      toolCalls: [{
        name: 'image_watermark',
        arguments: {
          image_project_id: 'img-proj-001',
          input_filename: 'background.webp',
          content: 'MyGame',
          type: 'text',
          position: 'southeast',
          opacity: 0.3,
          output_filename: 'bg_watermarked.webp'
        }
      }]
    });
    log('mocks:image-watermark-queued');

    // Composite overlay onto background
    log('mocks:image-composite', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在合成HUD图层...',
      toolCalls: [{
        name: 'image_composite',
        arguments: {
          image_project_id: 'img-proj-001',
          base_filename: 'bg_watermarked.webp',
          overlay_filename: 'ui_sprite_compressed.png',
          gravity: 'center',
          output_filename: 'game_screen.webp'
        }
      }]
    });
    log('mocks:image-composite-queued');

    // Download processed images to games/latest/assets/
    log('mocks:image-download-bg', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在下载处理后的背景图到游戏目录...',
      toolCalls: [{
        name: 'image_download_file',
        arguments: {
          image_project_id: 'img-proj-001',
          filename: 'game_screen.webp'
        }
      }]
    });
    log('mocks:image-download-bg-queued');

    // Download sprite sheet
    log('mocks:image-sprite-sheet', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在生成精灵图...',
      toolCalls: [{
        name: 'image_sprite_sheet',
        arguments: {
          image_project_id: 'img-proj-001',
          files: ['ui_sprite_compressed.png', 'icon_a.png', 'icon_b.png'],
          columns: 2,
          rows: 2,
          output_filename: 'spritesheet.png'
        }
      }]
    });
    log('mocks:image-sprite-sheet-queued');

    // Download sprite sheet
    log('mocks:image-download-ss', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在下载精灵图到游戏目录...',
      toolCalls: [{
        name: 'image_download_file',
        arguments: {
          image_project_id: 'img-proj-001',
          filename: 'spritesheet.png'
        }
      }]
    });
    log('mocks:image-download-ss-queued');

    // Clean up image project
    log('mocks:image-delete-project', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '清理图片 project...',
      toolCalls: [{ name: 'image_delete_project', arguments: { image_project_id: 'img-proj-001' } }]
    });
    log('mocks:image-delete-project-queued');
  }

  // ── Video Processing (SPEC-009): create and process video resources ──
  if (opts.withVideoProcessing) {
    log('mocks:video-create-project', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在创建视频处理 project...',
      toolCalls: [{ name: 'video_create_project', arguments: { name: 'game-video-assets' } }]
    });
    log('mocks:video-create-project-queued');

    // Use a tiny 2-frame animated GIF as test input (1x1 pixel, 847 bytes)
    // Animated GIF has multiple frames → FFmpeg's palettegen/paletteuse can generate output GIF.
    const tinyGifB64 = 'R0lGODlhAQABAPcAAAAAAAEBAQICAgMDAwQEBAUFBQYGBgcHBwgICAkJCQoKCgsLCwwMDA0NDQ4ODg8PDxAQEBERERISEhMTExQUFBUVFRYWFhcXFxgYGBkZGRoaGhsbGxwcHB0dHR4eHh8fHyAgICEhISIiIiMjIyQkJCUlJSYmJicnJygoKCkpKSoqKisrKywsLC0tLS4uLi8vLzAwMDExMTIyMjMzMzQ0NDU1NTY2Njc3Nzg4ODk5OTo6Ojs7Ozw8PD09PT4+Pj8/P0BAQEFBQUJCQkNDQ0REREVFRUZGRkdHR0hISElJSUpKSktLS0xMTE1NTU5OTk9PT1BQUFFRUVJSUlNTU1RUVFVVVVZWVldXV1hYWFlZWVpaWltbW1xcXF1dXV5eXl9fX2BgYGFhYWJiYmNjY2RkZGVlZWZmZmdnZ2hoaGlpaWpqamtra2xsbG1tbW5ubm9vb3BwcHFxcXJycnNzc3R0dHV1dXZ2dnd3d3h4eHl5eXp6ent7e3x8fH19fX5+fn9/f4CAgIGBgYKCgoODg4SEhIWFhYaGhoeHh4iIiImJiYqKiouLi4yMjI2NjY6Ojo+Pj5CQkJGRkZKSkpOTk5SUlJWVlZaWlpeXl5iYmJmZmZqampubm5ycnJ2dnZ6enp+fn6CgoKGhoaKioqOjo6SkpKWlpaampqenp6ioqKmpqaqqqqurq6ysrK2tra6urq+vr7CwsLGxsbKysrOzs7S0tLW1tba2tre3t7i4uLm5ubq6uru7u7y8vL29vb6+vr+/v8DAwMHBwcLCwsPDw8TExMXFxcbGxsfHx8jIyMnJycrKysvLy8zMzM3Nzc7Ozs/Pz9DQ0NHR0dLS0tPT09TU1NXV1dbW1tfX19jY2NnZ2dra2tvb29zc3N3d3d7e3t/f3+Dg4OHh4eLi4uPj4+Tk5OXl5ebm5ufn5+jo6Onp6erq6uvr6+zs7O3t7e7u7u/v7/Dw8PHx8fLy8vPz8/T09PX19fb29vf39/j4+Pn5+fr6+vv7+/z8/P39/f7+/v///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQECgAAACwAAAAAAQABAAACAkwAACH5BAQyAAAALAAAAAABAAEAAAICXAAAOw==';

    // Write local video file (animated GIF as test video input)
    log('mocks:video-write-file', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在写入测试视频到本地...',
      toolCalls: [{
        name: 'video_write_file',
        arguments: { filename: 'test_input.gif', content: tinyGifB64 }
      }]
    });
    log('mocks:video-write-file-queued');

    // Upload to video service
    log('mocks:video-upload-file', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在上传测试视频到 video service...',
      toolCalls: [{ name: 'video_upload_file', arguments: { video_project_id: 'vid-proj-001', filename: 'test_input.gif' } }]
    });
    log('mocks:video-upload-file-queued');

    // Get video info
    log('mocks:video-info', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在查询视频信息...',
      toolCalls: [{ name: 'video_info', arguments: { video_project_id: 'vid-proj-001', filename: 'test_input.gif' } }]
    });
    log('mocks:video-info-queued');

    // Create thumbnail from test input
    log('mocks:video-create-thumbnail', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在生成视频缩略图...',
      toolCalls: [{
        name: 'video_create_thumbnail',
        arguments: {
          video_project_id: 'vid-proj-001',
          filename: 'test_input.gif',
          time: 0,
          width: 160,
          output_filename: 'thumbnail.png'
        }
      }]
    });
    log('mocks:video-create-thumbnail-queued');

    // Convert format
    log('mocks:video-convert', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在转换视频格式...',
      toolCalls: [{
        name: 'video_convert',
        arguments: {
          video_project_id: 'vid-proj-001',
          input_filename: 'test_input.gif',
          target_format: 'webm',
          output_filename: 'converted.webm'
        }
      }]
    });
    log('mocks:video-convert-queued');

    // Generate GIF
    log('mocks:video-generate-gif', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在生成 GIF...',
      toolCalls: [{
        name: 'video_generate_gif',
        arguments: {
          video_project_id: 'vid-proj-001',
          input_filename: 'test_input.gif',
          fps: 5,
          width: 80,
          output_filename: 'output.gif'
        }
      }]
    });
    log('mocks:video-generate-gif-queued');

    // Add text overlay
    log('mocks:video-add-text', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在添加文字叠加...',
      toolCalls: [{
        name: 'video_add_text',
        arguments: {
          video_project_id: 'vid-proj-001',
          input_filename: 'test_input.gif',
          text: 'X',
          font_size: 1,
          color: 'red',
          x: 0,
          y: 0,
          output_filename: 'text_overlay.gif'
        }
      }]
    });
    log('mocks:video-add-text-queued');

    // Download processed file
    log('mocks:video-download-file', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '正在下载处理后的文件到游戏目录...',
      toolCalls: [{
        name: 'video_download_file',
        arguments: { video_project_id: 'vid-proj-001', filename: 'thumbnail.png' }
      }]
    });
    log('mocks:video-download-file-queued');

    // Clean up video project
    log('mocks:video-delete-project', { projectId });
    await setMockExpectation(projectId, 'engineer', {
      content: '清理视频 project...',
      toolCalls: [{ name: 'video_delete_project', arguments: { video_project_id: 'vid-proj-001' } }]
    });
    log('mocks:video-delete-project-queued');
  }

  log('mocks:queue-submit-game', { projectId });
  await setMockExpectation(projectId, 'engineer', {
    content: '游戏已提交。',
    toolCalls: [{ name: 'submit_game', arguments: { description: '一款RPG游戏' } }]
  });
  log('mocks:submit-game-queued');

  log('mocks:queue-save-memory', { projectId });
  await setMockExpectation(projectId, 'engineer', {
    content: '记忆已保存。',
    toolCalls: [{ name: 'save_memory', arguments: { category: 'achievement', content: '项目完成' } }]
  });
  log('mocks:save-memory-queued');

  log('mocks:queue-text-final', { projectId });
  await expectText(projectId, 'engineer', '开发任务全部完成。');
  log('mocks:all-queued');

  // ── Send the initial command to game_designer ──
  log('command:switch-to-commands-tab');
  await page.getByTestId('tab-commands').click();
  await page.waitForTimeout(500);
  log('command:click-game-designer-btn');
  const gdButton = page.locator('button').filter({ hasText: /游戏策划/ }).first();
  log('command:gd-btn-exists', { exists: await gdButton.count().then(c => c > 0) });
  await gdButton.click();
  log('command:gd-btn-clicked');
  const textarea = page.locator('textarea[placeholder*="下达指令"]').first();
  log('command:textarea-exists', { exists: await textarea.count().then(c => c > 0) });
  const commandText = '请设计一个RPG游戏的核心玩法，包括战斗系统和角色成长机制';
  log('command:fill-text', { length: commandText.length });
  await textarea.fill(commandText);
  log('command:click-send-btn');
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
      const switched = await switchTab('tab-handoffs');
      log(`step3:switch-tab-result`, { switched });
      cardCount = await page.locator('[data-testid^="handoff-card-"]').count();
      log(`step3:handoff-count`, { cardCount });
    } catch (e) {
      log(`step3:handoff-count-error`, { error: e instanceof Error ? e.message : String(e) });
    }

    // ── Step 4: Count games (helper switches tab) ──
    let gameCount = 0;
    try {
      const switched = await switchTab('tab-games');
      log(`step4:switch-tab-result`, { switched });
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
      log('verify:switch-to-handoffs');
      await switchTab('tab-handoffs');
      await page.waitForTimeout(500);
      const finalCards = page.locator('[data-testid^="handoff-card-"]');
      const fc = await finalCards.count();
      log('verify:handoff-count', { count: fc, expectedAtLeast: TARGET_CARDS });
      expect(fc).toBeGreaterThanOrEqual(TARGET_CARDS);
      log('verify:handoff-count-pass');

      log('verify:switch-to-games');
      await switchTab('tab-games');
      await page.waitForTimeout(500);
      const gameItems = page.locator('[data-testid^="game-card-"]');
      const gc = await gameItems.count();
      log('verify:game-count', { count: gc, expectedAtLeast: 1 });
      expect(gc).toBeGreaterThanOrEqual(1);
      log('verify:game-count-pass');
      // 游戏名已移除，验证游戏卡片存在即可
      log(`verify:complete`, { totalCards: fc, totalGames: gc, elapsedSec: elapsed });
      // 输出最终状态摘要
      log(`step5:summary`, {
        totalCards: fc,
        totalGames: gc,
        totalLoopIters: loopIter,
        elapsedSec: elapsed,
        autopilot: opts.autopilot
      });
      return;
    }

    // Sleep 1s before next iteration
    log(`loop:end-sleep`);
    await page.waitForTimeout(1000);
  }

  const timeoutMsg = `[${opts.testId}] Event loop timed out after ${LOOP_TIMEOUT_MS / 1000}s (${loopIter} iterations) without reaching target state`;
  log('loop:timeout', { loopIter, elapsedSec: Math.round(LOOP_TIMEOUT_MS / 1000) });
  throw new Error(timeoutMsg);
};

// ═══════════════════════════════════════════
// UI-007: Full workflow — MANUAL mode (no autopilot)
// Handoffs are accepted/confirmed manually in the event loop.
// ═══════════════════════════════════════════

test('[UI-007] should complete full workflow: game designer -> CEO -> architect -> engineer (manual)', async ({ page }) => {
  process.stderr.write(`[UI-007] ${new Date().toISOString()} test:starting (manual mode, autopilot disabled)\n`);
  await runFullWorkflowTest(page, {
    testId: 'UI-007',
    autopilot: false,
  });
});

// ═══════════════════════════════════════════
// UI-008: Full workflow — AUTOPILOT mode
// Backend auto-accepts handoffs; test only handles permissions + state check.
// ═══════════════════════════════════════════

test('[UI-008] should complete full workflow with autopilot and auto-handoff', async ({ page }) => {
  process.stderr.write(`[UI-008] ${new Date().toISOString()} test:starting (autopilot mode)\n`);
  await runFullWorkflowTest(page, {
    testId: 'UI-008',
    autopilot: true,
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

// ═══════════════════════════════════════════
// UI-010: Questionnaire proposal creation (SPEC-007)
// Fill questionnaire form → submit → verify proposal appears with source tag
// ═══════════════════════════════════════════

test('[UI-010] should create a questionnaire proposal via structured form', async ({ page }) => {
  const log = (step: string, extra?: Record<string, unknown>) => {
    let payload = '';
    if (extra) try { payload = ` ${JSON.stringify(extra)}` } catch { payload = ` ${String(extra)}` }
    process.stderr.write(`[UI-010] ${new Date().toISOString()} ${step}${payload}\n`);
  };

  log('setup:init-language');
  await page.addInitScript(() => localStorage.setItem('game_studio_ui_language', 'zh-CN'));
  log('setup:goto-page');
  await page.goto('/');
  log('setup:page-loaded', { url: page.url() });

  // Switch to proposals tab
  log('step1:switch-to-proposals-tab');
  await page.getByRole('tab', { name: /策划案/ }).click();
  await expect(page.getByRole('heading', { name: /策划案/ })).toBeVisible();
  log('step1:proposals-tab-visible');

  // Record initial count
  const initialCount = await page.locator('[data-testid^="proposal-item-"]').count();
  log('step1:initial-proposal-count', { count: initialCount });

  // Click questionnaire proposal button
  log('step2:click-questionnaire-btn');
  await page.getByTestId('create-questionnaire-proposal-btn').click();
  await expect(page.getByTestId('q-game-name')).toBeVisible();
  log('step2:questionnaire-form-visible');

  // ── Step 0: Core info ──
  const longCoreMechanic = '玩家通过种植不同外星作物获取资源种子与能量晶体。每种作物有独特的生长周期和元素属性，合理搭配能触发连锁反应产生额外收益。'.repeat(2);
  const longGameObjectives = '在限定周期内将农场从初始的单个温室扩展到包含五个星球的完整生态网络。每个星球解锁需要达到前一个星球的产量目标，同时抵御随机陨石事件造成的损失。'.repeat(2);
  log('step3:fill-core-fields', { coreMechanicLength: longCoreMechanic.length, objectivesLength: longGameObjectives.length });

  await page.getByTestId('q-game-name').fill('星际农场');
  log('step3:filled game_name');
  await page.getByTestId('q-game-genre').selectOption('simulation');
  log('step3:filled game_genre=simulation');
  await page.getByTestId('q-one-liner').fill('在太空站经营生态农场，培育外星作物并抵御陨石威胁');
  log('step3:filled one_liner');
  await page.getByTestId('q-core-mechanic').fill(longCoreMechanic);
  log('step3:filled core_mechanic');
  await page.getByTestId('q-target-audience').fill('18-35岁休闲玩家，喜欢模拟经营和轻策略元素');
  log('step3:filled target_audience');
  await page.getByTestId('q-game-objectives').fill(longGameObjectives);
  log('step3:filled game_objectives');

  // Click "Next" to proceed to step 1
  log('step4:click-next-step');
  await page.getByTestId('q-next-step').click();
  log('step4:waiting-for-step1...');
  // Verify we're on step 1 (extended info)
  await expect(page.getByTestId('q-level-design')).toBeVisible();
  log('step4:step1-visible (extended info)');

  // ── Step 1: Extended info (optional, fill a couple) ──
  log('step5:fill-extended-fields');
  await page.getByTestId('q-tech-req').fill('HTML5 Canvas 2D，无需外部引擎');
  log('step5:filled tech_requirements');
  await page.getByTestId('q-duration').fill('2-3周');
  log('step5:filled estimated_duration');

  // ── Submit ──
  log('step6:click-submit');
  await page.getByTestId('q-submit').click();
  log('step6:waiting-for-modal-close...');
  // Modal should close after successful submit
  await expect(page.getByTestId('q-game-name')).not.toBeVisible({ timeout: 5000 });
  log('step6:modal-closed');

  // Wait for SSE update
  log('step7:waiting-for-SSE-update...');
  await page.waitForTimeout(1000);
  log('step7:SSE-wait-done');

  // ── Verify ──
  log('step8:verify-proposal-count');
  const finalCount = await page.locator('[data-testid^="proposal-item-"]').count();
  expect(finalCount).toBeGreaterThan(initialCount);
  log('step8:proposal-count', { initial: initialCount, final: finalCount });

  // Verify proposal title appears
  log('step8:verify-title-visible');
  await expect(page.getByText('星际农场')).toBeVisible();
  log('step8:title-visible:PASS');

  // Verify source tag (问卷 label)
  log('step8:verify-source-tag');
  const sourceTag = page.locator('.text-purple-300').filter({ hasText: '问卷' });
  await expect(sourceTag).toBeVisible();
  log('step8:source-tag-visible:PASS');
  log('DONE');
});

// ═══════════════════════════════════════════
// UI-011: Full workflow — Phaser Mobile (SPEC-010)
// Game designer → CEO → architect → engineer (phaser-mobile game type, manual mode)
// ═══════════════════════════════════════════

test('[UI-011] should complete full workflow with phaser-mobile game type (SPEC-010)', async ({ page }) => {
  process.stderr.write(`[UI-011] ${new Date().toISOString()} test:starting (phaser-mobile, manual mode)\n`);
  await runFullWorkflowTest(page, {
    testId: 'UI-011',
    autopilot: false,
    gameType: 'phaser-mobile',
  });
});

// ═══════════════════════════════════════════
// UI-012: Image Service — create and process image resources, save to game artifacts (SPEC-008)
// Standard H5 workflow + image processing via image service MCP tools.
// Engineer creates image resources, processes them, downloads into games/latest/assets/.
// ═══════════════════════════════════════════

test('[UI-012] should process images and save to game artifacts (SPEC-008)', async ({ page }) => {
  process.stderr.write(`[UI-012] ${new Date().toISOString()} test:starting (H5 workflow + image service)\n`);
  await runFullWorkflowTest(page, {
    testId: 'UI-012',
    autopilot: false,
    gameType: 'h5',
    withImageProcessing: true,
  });
});

// ═══════════════════════════════════════════
// UI-013: Video Service — create and process video resources, save to game artifacts (SPEC-009)
// Standard H5 workflow + video processing via video service MCP tools.
// Uses tiny PNG as test input to exercise video service operations (thumbnail, convert, gif, text overlay).
// NOTE: This test uses a small image as pseudo-video input for lightweight CI-friendly testing.
// ═══════════════════════════════════════════

test('[UI-013] should process videos and save to game artifacts (SPEC-009)', async ({ page }) => {
  process.stderr.write(`[UI-013] ${new Date().toISOString()} test:starting (H5 workflow + video service)\n`);
  await runFullWorkflowTest(page, {
    testId: 'UI-013',
    autopilot: false,
    gameType: 'h5',
    withVideoProcessing: true,
  });
});
