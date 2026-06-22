import express from 'express';
import { unstable_v2_authenticate, Query } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';
import { agentManager } from './agent-manager.js';
import { getAllAgents, AgentRole } from './agents.js';
import { sseBroadcaster } from './sse-broadcaster.js';
import { starOfficeSyncService } from './star-office-sync.js';
import { StreamEvent } from './agent-manager.js';
import fileStorageRouter from './file-storage.js';
import proposalAttachmentsRouter from './proposal-attachments-api.js';
import { globalTokenManager, SonarQubeClient } from './lint/checkers/sonar/sonarqube.js';
import { sanitizeHtml } from './utils/sanitize-html.js';
import { renderQuestionnaireToMarkdown, GAME_GENRE_OPTIONS } from './utils/questionnaire-renderer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const CODEBUDDY_BASE_URL = process.env.CODEBUDDY_BASE_URL?.trim() || undefined;
const DEFAULT_PROJECT_ID = 'default';
const PROJECT_ID_PATTERN = db.PROJECT_ID_PATTERN;
const MAX_PROJECT_ID_LENGTH = db.MAX_PROJECT_ID_LENGTH;
const MAX_GAME_VERSION_LENGTH = db.MAX_VERSION_LENGTH;
const PROPOSAL_TYPES = new Set<db.DbProposal['type']>(db.PROPOSAL_TYPES);
const TASK_TYPES = new Set<db.DbTaskBoardTask['task_type']>(db.TASK_TYPES);
const HANDOFF_PRIORITIES = new Set<db.DbHandoff['priority']>(db.HANDOFF_PRIORITIES);
const USER_DECISIONS = new Set(['approved', 'rejected']);
const TEAM_BUILDING_AGENT_ID: AgentRole = 'team_builder';
let cachedAgentIdOptions: AgentRole[] | null = null;
let cachedAgentIdSet: Set<AgentRole> | null = null;
const getAgentIdOptions = (): AgentRole[] => {
  if (cachedAgentIdOptions) return cachedAgentIdOptions;
  cachedAgentIdOptions = getAllAgents().map(agent => agent.id);
  return cachedAgentIdOptions;
};
const getAgentIdSet = (): Set<AgentRole> => {
  if (cachedAgentIdSet) return cachedAgentIdSet;
  cachedAgentIdSet = new Set<AgentRole>(getAgentIdOptions());
  return cachedAgentIdSet;
};

// Normalizes project selector with PROJECT_ID_PATTERN/MAX_PROJECT_ID_LENGTH rules; invalid input falls back to default.
const normalizeProjectId = (value: unknown): string => {
  if (typeof value !== 'string') return DEFAULT_PROJECT_ID;
  const raw = value.trim();
  if (!raw) return DEFAULT_PROJECT_ID;
  if (raw.length > MAX_PROJECT_ID_LENGTH) return DEFAULT_PROJECT_ID;
  if (!PROJECT_ID_PATTERN.test(raw)) return DEFAULT_PROJECT_ID;
  return raw;
};

const validateProjectIdInput = (value: unknown, fieldName: string): { ok: true; projectId: string } | { ok: false; error: string } => {
  if (value === undefined || value === null) return { ok: true, projectId: DEFAULT_PROJECT_ID };
  if (typeof value !== 'string') return { ok: false, error: `${fieldName} 必须是字符串` };
  const raw = value.trim();
  if (!raw) return { ok: true, projectId: DEFAULT_PROJECT_ID };
  if (raw.length > MAX_PROJECT_ID_LENGTH) return { ok: false, error: `${fieldName} 长度不能超过 ${MAX_PROJECT_ID_LENGTH}` };
  if (!PROJECT_ID_PATTERN.test(raw)) return { ok: false, error: `${fieldName} 不合法，请使用字母数字下划线或短横线` };
  return { ok: true, projectId: raw };
};

const isEmptyProjectIdQuery = (value: unknown): boolean => value === undefined || (typeof value === 'string' && value.trim() === '');

const isProposalType = (value: string): value is db.DbProposal['type'] => PROPOSAL_TYPES.has(value as db.DbProposal['type']);

const validateAgentIdInput = (value: unknown, fieldName: string): { ok: true; agentId: AgentRole } | { ok: false; error: string } => {
  const options = getAgentIdOptions();
  const allowed = getAgentIdSet();
  if (typeof value !== 'string') return { ok: false, error: `${fieldName} 必须是字符串` };
  const agentId = value.trim();
  if (!allowed.has(agentId as AgentRole)) {
    return { ok: false, error: `${fieldName} 不合法，可选值：${options.join(' / ')}` };
  }
  return { ok: true, agentId: agentId as AgentRole };
};
const validateOptionalAgentIdInput = (
  value: unknown,
  fieldName: string
): { ok: true; agentId: AgentRole | null } | { ok: false; error: string } => {
  if (value === undefined || value === null) return { ok: true, agentId: null };
  if (typeof value !== 'string') return { ok: false, error: `${fieldName} 必须是字符串` };
  const raw = value.trim();
  if (!raw) return { ok: true, agentId: null };
  const validation = validateAgentIdInput(raw, fieldName);
  if (!validation.ok) return validation;
  return { ok: true, agentId: validation.agentId };
};
const validateTitleInput = (value: unknown, fieldName: string): { ok: true; title: string } | { ok: false; error: string } => {
  try {
    return { ok: true, title: db.normalizeAndValidateTitle(value, fieldName) };
  } catch (error: any) {
    return { ok: false, error: error?.message || `${fieldName} 不合法` };
  }
};
const validateRequiredTextInput = (value: unknown, fieldName: string): { ok: true; text: string } | { ok: false; error: string } => {
  try {
    return { ok: true, text: db.normalizeAndValidateRequiredText(value, fieldName) };
  } catch (error: any) {
    return { ok: false, error: error?.message || `${fieldName} 格式验证失败` };
  }
};
const validateOptionalTextInput = (value: unknown, fieldName: string): { ok: true; text: string | null } | { ok: false; error: string } => {
  try {
    return { ok: true, text: db.normalizeOptionalText(value, fieldName) };
  } catch (error: any) {
    return { ok: false, error: error?.message || `${fieldName} 格式验证失败` };
  }
};

app.use(express.json({ limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Bridge in-process agent events to SSE clients and remote Star-Office synchronization.
agentManager.on('agent_status_changed', (data) => {
  sseBroadcaster.broadcast({ type: 'agent_status_changed', ...data }, data.projectId);
  starOfficeSyncService.notifyAgentStatusChanged(data.projectId, data.agentId, data.state);
});
agentManager.on('stream_event', (data) => {
  const streamData = data as StreamEvent & { projectId?: string };
  sseBroadcaster.broadcast({ type: 'stream_event', event: streamData }, streamData.projectId);
  const streamType = String(streamData.type || '');
  const projectId = String(streamData.projectId || DEFAULT_PROJECT_ID);
  if (['agent_start', 'agent_done', 'agent_error', 'agent_paused_mid_task'].includes(streamType)) {
    starOfficeSyncService.scheduleProjectStateSync(projectId, `stream_event:${streamType}`);
  }
});
agentManager.on('agent_paused', (data) => {
  sseBroadcaster.broadcast({ type: 'agent_paused', ...data }, data.projectId);
  starOfficeSyncService.scheduleProjectStateSync(data.projectId, 'agent_paused');
});
agentManager.on('agent_resumed', (data) => {
  sseBroadcaster.broadcast({ type: 'agent_resumed', ...data }, data.projectId);
  starOfficeSyncService.scheduleProjectStateSync(data.projectId, 'agent_resumed');
});

// Lightweight service health endpoint for process liveness probes.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lists supported foundation models from the SDK runtime.
app.get('/api/models', async (req, res) => {
  try {
    const q = new Query('', CODEBUDDY_BASE_URL ? { endpoint: CODEBUDDY_BASE_URL } : {});
    const models = await q.supportedModels();
    res.json({ models: models || [] });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取模型列表失败', models: [] });
  }
});

// Unified observation stream: initial snapshot + incremental events via Server-Sent Events.
app.get('/api/observe', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const project = normalizeProjectId(req.query.projectId);

  // Send one full snapshot so the UI can hydrate all panels without extra round trips.
  const initialState = {
    type: 'init',
    projectId: project,
    agents: agentManager.getAllAgentStates(project),
    proposals: db.getAllProposals().filter(p => p.project_id === project),
    games: db.getAllGames().filter(g => g.project_id === project),
    logs: db.getLogs(project, undefined, 1000),
    tasks: db.getTaskBoardTasks(project),
    pendingPermissions: agentManager.getPendingPermissions(project)
  };
  res.write(`data: ${JSON.stringify(initialState)}\n\n`);

  sseBroadcaster.addClient(res, project);
  // Keep the SSE channel alive through proxy/load-balancer idle timeouts.
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (e) { clearInterval(heartbeat); sseBroadcaster.removeClient(res); }
  }, 30000);

  req.on('close', () => {
    sseBroadcaster.removeClient(res);
    clearInterval(heartbeat);
  });
});

// Auth probe endpoint used by UI to decide whether login actions are needed.
app.get('/api/check-login', async (req, res) => {
  const response: any = { isLoggedIn: false };
  try {
    let needsLogin = false;
    const result = await unstable_v2_authenticate({
      environment: 'external',
      ...(CODEBUDDY_BASE_URL ? { endpoint: CODEBUDDY_BASE_URL } : {}),
      onAuthUrl: async () => { needsLogin = true; }
    });
    if (!needsLogin && result?.userinfo) {
      response.isLoggedIn = true;
      response.userName = result.userinfo.userName;
    } else if (!needsLogin) {
      response.isLoggedIn = true;
    }
  } catch (error: any) {
    if (process.env.CODEBUDDY_API_KEY || process.env.CODEBUDDY_AUTH_TOKEN) {
      response.isLoggedIn = true;
      response.method = 'env';
    } else {
      response.error = error?.message;
    }
  }
  res.json(response);
});

// Returns static agent definitions merged with current per-project runtime state.
app.get('/api/agents', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId);
  const definitions = getAllAgents();
  const states = agentManager.getAllAgentStates(projectId);
  const statesMap = new Map(states.map(s => [s.id, s]));

  const agentsWithState = definitions.map(def => ({
    ...def,
    state: statesMap.get(def.id) || {
      id: def.id, status: 'idle', currentTask: null, lastMessage: null, lastActiveAt: null, isPaused: false
    }
  }));

  res.json({ agents: agentsWithState });
});

// Manual runtime controls for operator intervention.
app.post('/api/agents/:agentId/pause', (req, res) => {
  const { agentId } = req.params;
  const agentValidation = validateAgentIdInput(agentId, 'agentId');
  if (!agentValidation.ok) return res.status(400).json({ error: agentValidation.error });
  if (agentValidation.agentId === TEAM_BUILDING_AGENT_ID) {
    return res.status(400).json({ error: '团队建设 Agent 不支持暂停' });
  }
  const projectId = normalizeProjectId(req.query.projectId ?? req.body?.projectId);
  agentManager.pauseAgent(projectId, agentValidation.agentId);
  res.json({ success: true, message: `Agent ${agentId} 已暂停` });
});
app.post('/api/agents/:agentId/resume', (req, res) => {
  const { agentId } = req.params;
  const agentValidation = validateAgentIdInput(agentId, 'agentId');
  if (!agentValidation.ok) return res.status(400).json({ error: agentValidation.error });
  if (agentValidation.agentId === TEAM_BUILDING_AGENT_ID) {
    return res.status(400).json({ error: '团队建设 Agent 不支持恢复操作' });
  }
  const projectId = normalizeProjectId(req.query.projectId ?? req.body?.projectId);
  agentManager.resumeAgent(projectId, agentValidation.agentId);
  res.json({ success: true, message: `Agent ${agentId} 已恢复` });
});

// Executes an explicit user command against one agent and streams progress over SSE.
app.post('/api/agents/:agentId/command', async (req, res) => {
  const { agentId } = req.params;
  console.error('[DEBUG:command-handler] received POST agentId="%s" body=%s', agentId, JSON.stringify(req.body).slice(0, 200));
  const agentValidation = validateAgentIdInput(agentId, 'agentId');
  if (!agentValidation.ok) {
    console.error(`[DEBUG:command-handler] validation failed: ${agentValidation.error}`);
    return res.status(400).json({ error: agentValidation.error });
  }
  const normalizedAgentId = agentValidation.agentId;
  if (normalizedAgentId === TEAM_BUILDING_AGENT_ID) {
    return res.status(400).json({ error: '团队建设 Agent 不支持手动下达指令' });
  }
  const { message, model = 'glm-5.0', projectId: bodyProjectId } = req.body;
  const projectId = normalizeProjectId(req.query.projectId ?? bodyProjectId);

  if (!message) return res.status(400).json({ error: '指令内容不能为空' });
  const commandId = uuidv4();
  const command = db.createCommand({
    id: commandId,
    project_id: projectId,
    target_agent_id: normalizedAgentId,
    content: message,
    status: 'executing',
    result: null,
    created_at: new Date().toISOString(),
    executed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  db.addLog({
    id: uuidv4(),
    project_id: projectId,
    agent_id: normalizedAgentId,
    log_type: 'user_command',
    level: 'info',
    content: message,
    tool_name: null,
    action: '👤 用户指令',
    is_error: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`data: ${JSON.stringify({ type: 'command_started', commandId, agentId: normalizedAgentId })}\n\n`);

  // DEBUG: Send agent heartbeat to clear any stale "working" state
  console.error(`[DEBUG:command-handler] about to call sendMessage projectId="${projectId}" agentId="${normalizedAgentId}" message="${message.slice(0,50)}"`);

  try {
    const response = await agentManager.sendMessage(
      projectId,
      normalizedAgentId,
      message,
      model,
      (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    );

    db.updateCommand(commandId, { status: 'done', result: response.slice(0, 500) });
    res.write(`data: ${JSON.stringify({ type: 'command_done', commandId, response: response.slice(0, 500) })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error(`[DEBUG:command-handler] sendMessage failed: projectId="${projectId}" agentId="${normalizedAgentId}" error="${error?.message}" stack="${error?.stack?.slice(0, 200)}"`);
    db.updateCommand(commandId, { status: 'failed', result: error?.message });
    res.write(`data: ${JSON.stringify({ type: 'command_error', commandId, error: error?.message })}\n\n`);
    res.end();
  }
});

// Proposal domain APIs.
app.get('/api/proposals', (req, res) => {
  const projectValidation = validateProjectIdInput(req.query.projectId, 'projectId');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const project = projectValidation.projectId;
  const proposals = db.getAllProposals().filter(p => p.project_id === project);
  res.json({ proposals });
});
app.get('/api/proposals/:id', (req, res) => {
  const proposal = db.getProposal(req.params.id);
  if (!proposal) return res.status(404).json({ error: '提案不存在' });
  res.json({ proposal });
});
app.post('/api/proposals/:id/review', (req, res) => {
  const { id } = req.params;
  const { reviewer_agent_id, status, review_comment } = req.body;

  const proposal = db.getProposal(id);
  if (!proposal) return res.status(404).json({ error: '提案不存在' });

  const reviewerValidation = validateOptionalAgentIdInput(reviewer_agent_id, 'reviewer_agent_id');
  if (!reviewerValidation.ok) return res.status(400).json({ error: reviewerValidation.error });
  const reviewCommentValidation = validateOptionalTextInput(review_comment, 'review_comment');
  if (!reviewCommentValidation.ok) return res.status(400).json({ error: reviewCommentValidation.error });

  try {
    db.updateProposal(id, {
      status: status || 'under_review',
      reviewer_agent_id: reviewerValidation.agentId,
      review_comment: reviewCommentValidation.text
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '提案更新失败' });
  }

  const updated = db.getProposal(id);
  sseBroadcaster.broadcast({ type: 'proposal_reviewed', proposal: updated }, proposal.project_id);

  if (reviewerValidation.agentId) {
    agentManager.addLog(proposal.project_id, reviewerValidation.agentId, '评审提案', `提案: ${proposal.title} → ${status}`, 'info');
  }

  res.json({ success: true, proposal: updated });
});

// Project metadata and project-level settings APIs.
app.get('/api/projects', (req, res) => {
  const projects = db.getAllProjectIds().map(id => ({ id, name: db.getProject(id)?.name || id }));
  res.json({ projects });
});

app.get('/api/projects/:id/settings', (req, res) => {
  const projectId = normalizeProjectId(req.params.id);
  db.ensureProject(projectId);
  const settings = db.getProjectSettings(projectId);
  res.json({
    settings: {
      project_id: settings.project_id,
      autopilot_enabled: settings.autopilot_enabled === 1,
      team_builder_model: settings.team_builder_model
    }
  });
});

app.patch('/api/projects/:id/settings', async (req, res) => {
  const projectId = normalizeProjectId(req.params.id);
  db.ensureProject(projectId);
  const { autopilot_enabled, team_builder_model } = req.body as { autopilot_enabled?: boolean; team_builder_model?: string };
  if (autopilot_enabled === undefined && team_builder_model === undefined) {
    return res.status(400).json({ error: '缺少可更新字段：autopilot_enabled 或 team_builder_model' });
  }

  // 校验 team_builder_model
  if (team_builder_model !== undefined) {
    const validModels = ['glm-5.0', 'glm-5.0-turbo', 'kimi-k2.5', 'deepseek-v3-2-volc'];
    try {
      const q = new Query('', CODEBUDDY_BASE_URL ? { endpoint: CODEBUDDY_BASE_URL } : {});
      const models = await q.supportedModels();
      if (models && models.length > 0) {
        const validIds = models.map((m: any) => m.modelId || m.id || m.model).filter(Boolean);
        if (validIds.length > 0) {
          validModels.length = 0;
          validModels.push(...validIds);
        }
      }
    } catch { /* 降级：使用静态内置列表 */ }
    if (!validModels.includes(team_builder_model)) {
      return res.status(400).json({ error: `不支持的模型：${team_builder_model}` });
    }
  }

  const dbUpdates: Partial<db.DbProjectSettings> = {};
  if (autopilot_enabled !== undefined) {
    dbUpdates.autopilot_enabled = autopilot_enabled ? 1 : 0;
  }
  if (team_builder_model !== undefined) {
    dbUpdates.team_builder_model = team_builder_model;
  }
  const settings = db.updateProjectSettings(projectId, dbUpdates);
  res.json({
    settings: {
      project_id: settings.project_id,
      autopilot_enabled: settings.autopilot_enabled === 1,
      team_builder_model: settings.team_builder_model
    }
  });
});

app.post('/api/projects', (req, res) => {
  const requestedId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  const projectId = normalizeProjectId(requestedId);
  if (!requestedId || projectId === DEFAULT_PROJECT_ID) {
    return res.status(400).json({ error: '项目ID不合法，请使用字母数字下划线或短横线，且不能与默认项目冲突' });
  }
  const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const name = nameRaw || projectId;
  const existing = db.getProject(projectId);
  if (existing) {
    return res.status(409).json({ error: '项目已存在' });
  }
  const now = new Date().toISOString();
  const project = db.createProject({ id: projectId, name, created_at: now, updated_at: now });
  res.json({ project });
});
app.post('/api/projects/switch', async (req, res) => {
  // 多 project 架构下不再需要切换逻辑，所有 agent 始终同步
  const toProjectId = typeof req.body?.toProjectId === 'string'
    ? normalizeProjectId(req.body.toProjectId) : null;
  if (!toProjectId) return res.status(400).json({ error: '缺少目标项目ID' });
  res.json({ success: true });
});

// Game asset and preview APIs.
app.get('/api/games', (req, res) => {
  const projectValidation = validateProjectIdInput(req.query.projectId, 'projectId');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const project = projectValidation.projectId;
  const games = db.getAllGames().filter(g => g.project_id === project).map(g => {
    return {
      ...g,
      fileStorageId: g.file_storage_id || null,
      sonarStorageId: g.sonar_storage_id || null,
    };
  });
  res.json({ games });
});
app.get('/api/games/:id', (req, res) => {
  const game = db.getGame(req.params.id);
  if (!game) return res.status(404).json({ error: '游戏不存在' });
  res.json({ game: { ...game, fileStorageId: game.file_storage_id || null, sonarStorageId: game.sonar_storage_id || null } });
});
app.patch('/api/games/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  let success = false;
  try {
    success = db.updateGame(id, updates);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '游戏更新参数不合法' });
  }
  if (!success) return res.status(404).json({ error: '游戏不存在' });

  const game = db.getGame(id);
  if (!game) return res.status(500).json({ error: '游戏更新后读取失败' });
  sseBroadcaster.broadcast({ type: 'game_updated', game: { ...game, fileStorageId: game.file_storage_id || null } }, game.project_id);
  res.json({ success: true, game: game });
});

// Audit/log retrieval and maintenance APIs.
app.get('/api/projects/:projectId/logs', (req, res) => {
  const projectId = normalizeProjectId(req.params.projectId);
  const agentId = req.query.agentId as string | undefined;
  const logType = req.query.log_type as string | undefined;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 1000;
  const validLogType = logType && ['system', 'text', 'tool', 'tool_result', 'done', 'error', 'user_command'].includes(logType) ? logType as db.LogType : undefined;
  console.error(`[DEBUG:logs-api] query: projectId=${projectId} agentId=${agentId} log_type=${logType} limit=${limit}`);
  const logs = db.getLogs(projectId, agentId, limit, validLogType);
  res.json({ logs });
});

app.delete('/api/projects/:projectId/logs', (req, res) => {
  const projectId = normalizeProjectId(req.params.projectId);
  const agentId = typeof req.query.agentId === 'string' ? req.query.agentId.trim() : '';
  db.deleteLogs(projectId, agentId || undefined);
  sseBroadcaster.broadcast({ type: 'logs_cleared', projectId, agentId: agentId || null }, projectId);
  res.json({ success: true });
});
app.get('/api/commands', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId);
  const commands = db.getAllCommands(projectId);
  res.json({ commands });
});
app.post('/api/permission-response', (req, res) => {
  const { requestId, behavior, message, projectId: bodyProjectId, updatedInput } = req.body;
  const projectId = normalizeProjectId(bodyProjectId ?? req.query.projectId);
  const success = agentManager.respondToPermission(requestId, behavior, message, projectId, updatedInput);
  if (!success) return res.status(404).json({ error: '权限请求不存在或已超时' });
  res.json({ success: true });
});

// Inter-agent handoff lifecycle APIs.
app.get('/api/handoffs', (req, res) => {
  const projectValidation = validateProjectIdInput(req.query.projectId, 'projectId');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const projectId = projectValidation.projectId;
  const { agentId, status, limit } = req.query;
  let handoffs;

  if (agentId) {
    // Agent-specific view returns the database result format directly for compatibility.
    const result = db.getHandoffsForAgent(projectId, agentId as string, limit ? parseInt(limit as string) : 20);
    return res.json(result);
  } else if (status) {
    const all = db.getAllHandoffs(projectId, limit ? parseInt(limit as string) : 50);
    handoffs = all.filter(h => h.status === status);
  } else {
    handoffs = db.getAllHandoffs(projectId, limit ? parseInt(limit as string) : 50);
  }

  res.json({ handoffs });
});
app.get('/api/handoffs/pending', (req, res) => {
  const projectValidation = validateProjectIdInput(req.query.projectId, 'projectId');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const projectId = projectValidation.projectId;
  const { toAgentId } = req.query;
  const handoffs = db.getPendingHandoffs(projectId, toAgentId as string | undefined);
  res.json({ handoffs });
});
app.post('/api/handoffs', (req, res) => {
  const { from_agent_id, to_agent_id, title, description, context, priority, source_command_id, project_id } = req.body;
  const projectIdRaw = project_id ?? req.query.projectId;
  const projectFieldName = project_id !== undefined ? 'project_id' : 'projectId';
  const projectValidation = validateProjectIdInput(projectIdRaw, projectFieldName);
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const projectId = projectValidation.projectId;

  if (!from_agent_id || !to_agent_id || !title || !description) {
    return res.status(400).json({ error: '缺少必要字段：from_agent_id, to_agent_id, title, description' });
  }
  const fromAgentValidation = validateAgentIdInput(from_agent_id, 'from_agent_id');
  if (!fromAgentValidation.ok) return res.status(400).json({ error: fromAgentValidation.error });
  const toAgentValidation = validateAgentIdInput(to_agent_id, 'to_agent_id');
  if (!toAgentValidation.ok) return res.status(400).json({ error: toAgentValidation.error });
  if (fromAgentValidation.agentId === toAgentValidation.agentId) {
    return res.status(400).json({ error: 'from_agent_id 与 to_agent_id 不能相同' });
  }
  if (priority !== undefined && priority !== null && (typeof priority !== 'string' || !HANDOFF_PRIORITIES.has(priority as db.DbHandoff['priority']))) {
    return res.status(400).json({ error: 'priority 仅支持 low / normal / high / urgent' });
  }
  if (source_command_id !== undefined && source_command_id !== null && typeof source_command_id !== 'string') {
    return res.status(400).json({ error: 'source_command_id 必须是字符串' });
  }
  const titleValidation = validateTitleInput(title, 'title');
  if (!titleValidation.ok) return res.status(400).json({ error: titleValidation.error });
  const descriptionValidation = validateRequiredTextInput(description, 'description');
  if (!descriptionValidation.ok) return res.status(400).json({ error: descriptionValidation.error });
  const contextValidation = validateOptionalTextInput(context, 'context');
  if (!contextValidation.ok) return res.status(400).json({ error: contextValidation.error });

  const now = new Date().toISOString();
  const settings = db.getProjectSettings(projectId);
  const autoHandoffEnabled = settings.autopilot_enabled === 1;
  const normalizedPriority = (typeof priority === 'string' ? priority : 'normal') as db.DbHandoff['priority'];
  const handoff = db.createHandoff({
    id: uuidv4(),
    project_id: projectId,
      from_agent_id: fromAgentValidation.agentId,
      to_agent_id: toAgentValidation.agentId,
    title: titleValidation.title,
    description: descriptionValidation.text,
    context: contextValidation.text,
    status: autoHandoffEnabled ? 'working' : 'pending',
    priority: normalizedPriority,
    result: null,
    accepted_at: autoHandoffEnabled ? now : null,
    completed_at: null,
    source_command_id: source_command_id || null,
    created_at: now,
    updated_at: now,
  });
  sseBroadcaster.broadcast({ type: 'handoff_created', handoff }, handoff.project_id);
  agentManager.addLog(handoff.project_id, handoff.from_agent_id as AgentRole, '创建交接', `${handoff.from_agent_id} → ${handoff.to_agent_id}: ${handoff.title}`, 'info');
  if (autoHandoffEnabled) {
    // When auto-handoff is enabled, dispatch immediately instead of waiting for manual accept/confirm.
    agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '自动接收交接', `从 ${handoff.from_agent_id} 接手: ${handoff.title}`, 'success');
    agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '开始执行交接任务', `${handoff.title}`, 'success');
    agentManager.sendMessage(
      handoff.project_id,
      handoff.to_agent_id as AgentRole,
      `【任务交接】你收到了来自 ${handoff.from_agent_id} 的任务交接。\n\n## 任务标题\n${handoff.title}\n\n## 任务描述\n${handoff.description}\n\n${handoff.context ? `## 上下文信息\n${handoff.context}\n\n` : ''}请按照上述要求完成任务。完成后请提交相关成果。`
    ).catch(error => {
      agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '交接任务执行失败', error?.message || String(error), 'error');
    });
  }

  res.json({ handoff });
});
app.post('/api/handoffs/:id/accept', (req, res) => {
  const { id } = req.params;
  const handoff = db.getHandoff(id);
  if (!handoff) return res.status(404).json({ error: '交接记录不存在' });
  const settings = db.getProjectSettings(handoff.project_id);
  if (settings.autopilot_enabled === 1) {
    if (handoff.status !== 'pending') {
      return res.status(400).json({ error: '当前项目已开启自动交接，无需手动接收' });
    }

    const now = new Date().toISOString();
    // Backward-compatible path for old pending records created before autopilot toggle.
    db.updateHandoff(id, { status: 'working', accepted_at: now });
    const updated = db.getHandoff(id)!;

    sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated }, handoff.project_id);
    agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '兼容处理：自动接收自动交接开启前历史待处理交接', `从 ${handoff.from_agent_id} 接手: ${handoff.title}`, 'success');

    agentManager.sendMessage(
      handoff.project_id,
      handoff.to_agent_id as AgentRole,
      `【任务交接】你收到了来自 ${handoff.from_agent_id} 的任务交接。\n\n## 任务标题\n${handoff.title}\n\n## 任务描述\n${handoff.description}\n\n${handoff.context ? `## 上下文信息\n${handoff.context}\n\n` : ''}请按照上述要求完成任务。完成后请提交相关成果。`
    ).catch(error => {
      agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '交接任务执行失败', error?.message || String(error), 'error');
    });

    return res.json({ handoff: updated });
  }
  if (handoff.status !== 'pending') {
    return res.status(400).json({ error: `交接状态不是待处理，当前状态: ${handoff.status}` });
  }

  const now = new Date().toISOString();
  db.updateHandoff(id, { status: 'accepted', accepted_at: now });
  const updated = db.getHandoff(id)!;

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated }, handoff.project_id);
  agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '接受交接', `从 ${handoff.from_agent_id} 接手: ${handoff.title}`, 'success');

  res.json({ handoff: updated });
});
app.post('/api/handoffs/:id/confirm', (req, res) => {
  const { id } = req.params;
  const handoff = db.getHandoff(id);
  if (!handoff) return res.status(404).json({ error: '交接记录不存在' });
  const settings = db.getProjectSettings(handoff.project_id);
  const autoHandoffEnabled = settings.autopilot_enabled === 1;
  if (!autoHandoffEnabled && handoff.status !== 'accepted') {
    return res.status(400).json({ error: `交接状态不是已接受，当前状态: ${handoff.status}，需要先接受交接` });
  }
  if (autoHandoffEnabled && handoff.status !== 'working') {
    return res.status(400).json({ error: `自动交接模式下仅支持处理中状态，当前状态: ${handoff.status}` });
  }

  const now = new Date().toISOString();
  db.updateHandoff(id, { status: 'working' });
  const updated = db.getHandoff(id)!;

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated }, handoff.project_id);
  agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '开始执行交接任务', `${handoff.title}`, 'success');
  agentManager.sendMessage(
    handoff.project_id,
    handoff.to_agent_id as AgentRole,
    `【任务交接】你收到了来自 ${handoff.from_agent_id} 的任务交接。\n\n## 任务标题\n${handoff.title}\n\n## 任务描述\n${handoff.description}\n\n${handoff.context ? `## 上下文信息\n${handoff.context}\n\n` : ''}请按照上述要求完成任务。完成后请提交相关成果。`
  ).catch(error => {
    agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '交接任务执行失败', error?.message || String(error), 'error');
  });

  res.json({ handoff: updated });
});
app.post('/api/handoffs/:id/complete', (req, res) => {
  const { id } = req.params;
  const { result } = req.body;
  const handoff = db.getHandoff(id);
  if (!handoff) return res.status(404).json({ error: '交接记录不存在' });
  const resultValidation = validateOptionalTextInput(result, 'result');
  if (!resultValidation.ok) return res.status(400).json({ error: resultValidation.error });

  const now = new Date().toISOString();
  try {
    db.updateHandoff(id, { status: 'completed', result: resultValidation.text, completed_at: now });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '交接参数不合法' });
  }
  const updated = db.getHandoff(id)!;

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated }, handoff.project_id);
  agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '完成交接任务', `完成: ${handoff.title}`, 'success');
  agentManager.addLog(handoff.project_id, handoff.from_agent_id as AgentRole, '交接任务已完成', `${handoff.to_agent_id} 完成了: ${handoff.title}`, 'info');

  res.json({ handoff: updated });
});
app.post('/api/handoffs/:id/reject', (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const handoff = db.getHandoff(id);
  if (!handoff) return res.status(404).json({ error: '交接记录不存在' });
  if (handoff.status !== 'pending') {
    return res.status(400).json({ error: `交接状态不是待处理，当前状态: ${handoff.status}` });
  }
  const reasonValidation = validateOptionalTextInput(reason, 'reason');
  if (!reasonValidation.ok) return res.status(400).json({ error: reasonValidation.error });

  try {
    db.updateHandoff(id, { status: 'rejected', result: reasonValidation.text || '被拒绝' });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '交接参数不合法' });
  }
  const updated = db.getHandoff(id)!;

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated }, handoff.project_id);
  agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '拒绝交接', `拒绝来自 ${handoff.from_agent_id} 的: ${handoff.title}`, 'warn');
  agentManager.addLog(handoff.project_id, handoff.from_agent_id as AgentRole, '交接被拒绝', `${handoff.to_agent_id} 拒绝了: ${handoff.title}`, 'warn');

  res.json({ handoff: updated });
});
app.post('/api/handoffs/:id/cancel', (req, res) => {
  const { id } = req.params;
  const handoff = db.getHandoff(id);
  if (!handoff) return res.status(404).json({ error: '交接记录不存在' });

  db.updateHandoff(id, { status: 'cancelled' });
  const updated = db.getHandoff(id)!;

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated }, handoff.project_id);
  agentManager.addLog(handoff.project_id, handoff.from_agent_id as AgentRole, '取消交接', `取消了: ${handoff.title}`, 'warn');

  res.json({ handoff: updated });
});

// Task-board APIs and enforced state machine transitions.
const TASK_STATUS_FLOW: Record<string, string[]> = {
  todo: ['developing', 'blocked'],
  developing: ['testing', 'blocked'],
  testing: ['done', 'blocked', 'developing'],
  blocked: ['todo', 'developing', 'testing'],
  done: []
};

app.get('/api/tasks', (req, res) => {
  let tasks: db.DbTaskBoardTask[];
  if (isEmptyProjectIdQuery(req.query.projectId)) {
    tasks = db.getTaskBoardTasks(undefined);
  } else {
    const projectValidation = validateProjectIdInput(req.query.projectId, 'projectId');
    if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
    tasks = db.getTaskBoardTasks(projectValidation.projectId);
  }
  res.json({ tasks });
});

app.post('/api/tasks', (req, res) => {
  const {
    project_id,
    title,
    description,
    task_type,
    created_by,
    split_testing_task
  } = req.body;
  const projectValidation = validateProjectIdInput(project_id, 'project_id');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });

  if (!title || !task_type || !created_by) {
    return res.status(400).json({ error: '缺少必要字段：title, task_type, created_by' });
  }
  if (!TASK_TYPES.has(task_type)) {
    return res.status(400).json({ error: 'task_type 仅支持 development 或 testing' });
  }
  const createdByValidation = validateAgentIdInput(created_by, 'created_by');
  if (!createdByValidation.ok) return res.status(400).json({ error: createdByValidation.error });
  if (split_testing_task !== undefined && typeof split_testing_task !== 'boolean') {
    return res.status(400).json({ error: 'split_testing_task 必须是布尔值' });
  }
  const titleValidation = validateTitleInput(title, 'title');
  if (!titleValidation.ok) return res.status(400).json({ error: titleValidation.error });
  const descriptionValidation = validateOptionalTextInput(description, 'description');
  if (!descriptionValidation.ok) return res.status(400).json({ error: descriptionValidation.error });

  const now = new Date().toISOString();
  const task = db.createTaskBoardTask({
    id: uuidv4(),
    project_id: projectValidation.projectId,
    title: titleValidation.title,
    description: descriptionValidation.text,
    task_type,
    status: 'todo',
    source_task_id: null,
    created_by: createdByValidation.agentId,
    updated_by: createdByValidation.agentId,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now
  });

  sseBroadcaster.broadcast({ type: 'task_created', task }, task.project_id);
  agentManager.addLog(task.project_id, createdByValidation.agentId, '创建看板任务', `${task_type === 'development' ? '开发' : '测试'}任务: ${task.title}`, 'info');

  let testingTask: db.DbTaskBoardTask | null = null;
  if (split_testing_task && task_type === 'development') {
    testingTask = db.createTaskBoardTask({
      id: uuidv4(),
      project_id: projectValidation.projectId,
      title: `${titleValidation.title}（测试）`,
      description: descriptionValidation.text ? `由开发任务拆分：${descriptionValidation.text}` : '由开发任务自动拆分的测试任务',
      task_type: 'testing',
      status: 'todo',
      source_task_id: task.id,
      created_by: createdByValidation.agentId,
      updated_by: createdByValidation.agentId,
      started_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now
    });
    sseBroadcaster.broadcast({ type: 'task_created', task: testingTask }, testingTask.project_id);
    agentManager.addLog(testingTask.project_id, createdByValidation.agentId, '拆分测试任务', `从开发任务拆分测试任务: ${testingTask.title}`, 'info');
  }

  res.json({ task, testingTask });
});

app.patch('/api/tasks/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, updated_by } = req.body;
  const task = db.getTaskBoardTask(id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (!status || !TASK_STATUS_FLOW[task.status]?.includes(status)) {
    return res.status(400).json({ error: `非法状态流转: ${task.status} -> ${status}` });
  }

  const updatedByValidation = validateOptionalAgentIdInput(updated_by, 'updated_by');
  if (!updatedByValidation.ok) return res.status(400).json({ error: updatedByValidation.error });

  const now = new Date().toISOString();
  const updates: Partial<db.DbTaskBoardTask> = {
    status,
    updated_by: updatedByValidation.agentId
  };

  if (status === 'developing' || status === 'testing') {
    // Preserve first start time to keep lead-time metrics stable.
    updates.started_at = task.started_at || now;
  }
  if (status === 'done') {
    updates.completed_at = now;
  } else if (task.status === 'done') {
    updates.completed_at = null;
  }

  let success: boolean;
  try {
    success = db.updateTaskBoardTask(id, updates);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '任务参数不合法' });
  }
  if (!success) return res.status(500).json({ error: '任务状态更新失败' });
  const updated = db.getTaskBoardTask(id)!;
  sseBroadcaster.broadcast({ type: 'task_updated', task: updated }, task.project_id);
  const taskCreatorValidation = validateAgentIdInput(task.created_by, 'task.created_by');
  if (!taskCreatorValidation.ok) return res.status(500).json({ error: '内部错误：任务创建者数据不合法' });
  const taskOperator = updatedByValidation.agentId || taskCreatorValidation.agentId;
  agentManager.addLog(task.project_id, taskOperator, '更新任务状态', `${task.title}: ${task.status} → ${status}`, 'success');
  res.json({ task: updated });
});

// Agent memory APIs.
app.get('/api/agents/:agentId/memories', (req, res) => {
  const { agentId } = req.params;
  const agentValidation = validateAgentIdInput(agentId, 'agentId');
  if (!agentValidation.ok) return res.status(400).json({ error: agentValidation.error });
  const { category } = req.query;
  const projectId = normalizeProjectId(req.query.projectId);
  const memories = db.getAgentMemories(projectId, agentValidation.agentId, category as string | undefined);
  res.json({ memories });
});
app.get('/api/memories', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId);
  const memories = db.getAllAgentMemories(projectId);
  res.json({ memories });
});
app.post('/api/agents/:agentId/memories', (req, res) => {
  const { agentId } = req.params;
  const agentValidation = validateAgentIdInput(agentId, 'agentId');
  if (!agentValidation.ok) return res.status(400).json({ error: agentValidation.error });
  const { category = 'general', content, importance = 'normal', source_task, projectId: bodyProjectId } = req.body;
  const projectId = normalizeProjectId(req.query.projectId ?? bodyProjectId);

  if (!content) return res.status(400).json({ error: '记忆内容不能为空' });

  const now = new Date().toISOString();
  const memory = db.createAgentMemory({
    id: uuidv4(),
    project_id: projectId,
    agent_id: agentValidation.agentId,
    category,
    content: content.slice(0, 5000),
    importance,
    source_task: source_task || null,
    created_at: now,
    updated_at: now
  });

  agentManager.addLog(projectId, agentValidation.agentId, '保存记忆', `类别: ${category} | 重要度: ${importance}`, 'info');

  res.json({ memory });
});
app.delete('/api/memories/:id', (req, res) => {
  const success = db.deleteAgentMemory(req.params.id);
  if (!success) return res.status(404).json({ error: '记忆不存在' });
  res.json({ success: true });
});
app.delete('/api/agents/:agentId/memories', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId ?? req.body?.projectId);
  db.clearAgentMemories(projectId, req.params.agentId);
  res.json({ success: true });
});

// Static publishing of generated output artifacts (HTML previews, etc.).
db.ensureOutputDir();

// FileStorage API（MinIO 对象管理）
app.use('/api/file-storage', fileStorageRouter);
app.use('/api/proposals', proposalAttachmentsRouter);

app.use('/output', express.static(path.join(__dirname, '..', 'output'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

// Proposal submission and human-decision APIs.
// SPEC-007: GET /api/game-types — 获取已注册的游戏工程类型
app.get('/api/game-types', (_req, res) => {
  const gameTypes = db.getGameTypes();
  console.log('[DEBUG:game-types] GET /api/game-types →', gameTypes.length, 'types');
  res.json({ game_types: gameTypes });
});

// SPEC-007: POST /api/proposals/questionnaire — 问卷式提案提交
app.post('/api/proposals/questionnaire', (req, res) => {
  const { project_id, author_agent_id, game_name, game_type, game_genre, one_liner, core_mechanic, target_audience, game_objectives, level_design, ui_ux_notes, tech_requirements, estimated_duration, reference_games, monetization_hint } = req.body;
  console.log('[DEBUG:questionnaire] POST /api/proposals/questionnaire → received', {
    project_id, author_agent_id, game_name,
    has_game_type: !!game_type, game_type,
    game_genre, one_liner_length: one_liner?.length,
    core_mechanic_length: core_mechanic?.length,
    target_audience_length: target_audience?.length,
    game_objectives_length: game_objectives?.length,
    has_level_design: !!level_design, has_ui_ux_notes: !!ui_ux_notes,
    has_tech_requirements: !!tech_requirements, has_estimated_duration: !!estimated_duration,
    has_reference_games: !!reference_games, has_monetization_hint: !!monetization_hint,
  });

  // 1. 校验必填字段
  console.log('[DEBUG:questionnaire] step1: validating required fields...');
  const projectValidation = validateProjectIdInput(project_id, 'project_id');
  if (!projectValidation.ok) { console.log('[DEBUG:questionnaire] step1:FAIL project_id', projectValidation.error); return res.status(400).json({ error: projectValidation.error }); }
  const authorValidation = validateAgentIdInput(author_agent_id, 'author_agent_id');
  if (!authorValidation.ok) { console.log('[DEBUG:questionnaire] step1:FAIL author_agent_id', authorValidation.error); return res.status(400).json({ error: authorValidation.error }); }

  const gameNameValidation = (() => {
    try { return { ok: true as const, value: db.normalizeAndValidateGameName(game_name, 'game_name') }; }
    catch (e: any) { return { ok: false as const, error: e?.message || 'game_name 不合法' }; }
  })();
  if (!gameNameValidation.ok) { console.log('[DEBUG:questionnaire] step1:FAIL game_name', gameNameValidation.error); return res.status(400).json({ error: gameNameValidation.error }); }

  if (!game_genre || typeof game_genre !== 'string' || !GAME_GENRE_OPTIONS.includes(game_genre as any)) {
    console.log('[DEBUG:questionnaire] step1:FAIL game_genre', game_genre);
    return res.status(400).json({ error: `game_genre 不合法，可选值：${GAME_GENRE_OPTIONS.join(' / ')}` });
  }
  const oneLinerValidation = (() => {
    try {
      const val = db.normalizeAndValidateRequiredText(one_liner, 'one_liner');
      if (!db.SINGLE_LINE_TITLE_PATTERN.test(val)) return { ok: false as const, error: 'one_liner 不允许包含换行符' };
      return { ok: true as const, value: val };
    } catch (e: any) { return { ok: false as const, error: e?.message || 'one_liner 不合法' }; }
  })();
  if (!oneLinerValidation.ok) { console.log('[DEBUG:questionnaire] step1:FAIL one_liner', oneLinerValidation.error); return res.status(400).json({ error: oneLinerValidation.error }); }

  const coreMechanicValidation = (() => {
    try {
      const val = db.normalizeAndValidateRequiredText(core_mechanic, 'core_mechanic');
      if (val.length < 50) return { ok: false as const, error: 'core_mechanic 最少 50 个字符' };
      if (val.length > 2000) return { ok: false as const, error: 'core_mechanic 不能超过 2000 个字符' };
      return { ok: true as const, value: val };
    } catch (e: any) { return { ok: false as const, error: e?.message || 'core_mechanic 不合法' }; }
  })();
  if (!coreMechanicValidation.ok) { console.log('[DEBUG:questionnaire] step1:FAIL core_mechanic', coreMechanicValidation.error); return res.status(400).json({ error: coreMechanicValidation.error }); }

  const targetAudienceValidation = validateRequiredTextInput(target_audience, 'target_audience');
  if (!targetAudienceValidation.ok) { console.log('[DEBUG:questionnaire] step1:FAIL target_audience', targetAudienceValidation.error); return res.status(400).json({ error: targetAudienceValidation.error }); }

  const gameobjectivesValidation = (() => {
    try {
      const val = db.normalizeAndValidateRequiredText(game_objectives, 'game_objectives');
      if (val.length < 50) return { ok: false as const, error: 'game_objectives 最少 50 个字符' };
      if (val.length > 2000) return { ok: false as const, error: 'game_objectives 不能超过 2000 个字符' };
      return { ok: true as const, value: val };
    } catch (e: any) { return { ok: false as const, error: e?.message || 'game_objectives 不合法' }; }
  })();
  if (!gameobjectivesValidation.ok) { console.log('[DEBUG:questionnaire] step1:FAIL game_objectives', gameobjectivesValidation.error); return res.status(400).json({ error: gameobjectivesValidation.error }); }

  console.log('[DEBUG:questionnaire] step1:PASS all required fields');

  // 2. 可选字段 game_type 校验
  if (game_type !== undefined && game_type !== null && game_type !== '') {
    if (typeof game_type !== 'string' || !db.isValidGameType(game_type.trim())) {
      console.log('[DEBUG:questionnaire] step2:FAIL game_type not registered', game_type);
      return res.status(400).json({ error: 'game_type 未注册，请检查可用值' });
    }
    console.log('[DEBUG:questionnaire] step2: game_type validated', game_type);
  } else {
    console.log('[DEBUG:questionnaire] step2: game_type omitted (optional)');
  }

  // 3. 组装 QuestionnaireInput
  console.log('[DEBUG:questionnaire] step3: assembling questionnaire input...');
  const questionnaireInput = {
    game_name: gameNameValidation.value,
    game_type: game_type ? db.normalizeOptionalText(game_type, 'game_type') || undefined : undefined,
    game_genre: game_genre as any,
    one_liner: oneLinerValidation.value,
    core_mechanic: coreMechanicValidation.value,
    target_audience: targetAudienceValidation.text,
    game_objectives: gameobjectivesValidation.value,
    level_design: db.normalizeOptionalText(level_design, 'level_design') || undefined,
    ui_ux_notes: db.normalizeOptionalText(ui_ux_notes, 'ui_ux_notes') || undefined,
    tech_requirements: db.normalizeOptionalText(tech_requirements, 'tech_requirements') || undefined,
    estimated_duration: db.normalizeOptionalText(estimated_duration, 'estimated_duration') || undefined,
    reference_games: db.normalizeOptionalText(reference_games, 'reference_games') || undefined,
    monetization_hint: db.normalizeOptionalText(monetization_hint, 'monetization_hint') || undefined,
  };

  // 4. 渲染 Markdown
  console.log('[DEBUG:questionnaire] step4: rendering markdown...');
  const markdownContent = renderQuestionnaireToMarkdown(questionnaireInput);
  console.log('[DEBUG:questionnaire] step4: markdown rendered, length =', markdownContent.length);

  // 5. sanitizeHtml
  const safeContent = sanitizeHtml(markdownContent);
  console.log('[DEBUG:questionnaire] step5: sanitized, length =', safeContent.length);

  // 6. 创建 proposal
  console.log('[DEBUG:questionnaire] step6: creating proposal in DB...');
  const now = new Date().toISOString();
  const proposal = db.createProposal({
    id: uuidv4(),
    project_id: projectValidation.projectId,
    type: 'game_design',
    title: gameNameValidation.value,
    content: safeContent,
    author_agent_id: authorValidation.agentId,
    status: 'pending_review',
    reviewer_agent_id: null,
    review_comment: null,
    user_decision: null,
    user_comment: null,
    version: 1,
    parent_id: null,
    source: 'questionnaire',
    created_at: now,
    updated_at: now,
  });
  db.ensureProject(proposal.project_id);
  const filePath = db.saveProposalToFile(proposal);
  console.log('[DEBUG:questionnaire] step6: proposal created → id=%s, source=questionnaire, file=%s', proposal.id, filePath);
  sseBroadcaster.broadcast({ type: 'proposal_created', proposal, filePath }, proposal.project_id);
  console.log('[DEBUG:questionnaire] step7: SSE broadcast proposal_created');
  agentManager.addLog(proposal.project_id, authorValidation.agentId, '提交问卷提案', `问卷提案: ${proposal.title}`, 'success');

  console.log('[DEBUG:questionnaire] DONE → 200, proposal.id=%s', proposal.id);
  res.json({ proposal });
});

app.post('/api/proposals', (req, res) => {
  const { project_id, type, title, content, author_agent_id } = req.body;
  const projectValidation = validateProjectIdInput(project_id, 'project_id');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  if (!type || !title || !content || !author_agent_id) {
    return res.status(400).json({ error: '缺少必要字段' });
  }
  if (typeof type !== 'string' || !isProposalType(type)) {
    return res.status(400).json({ error: 'type 不合法，仅支持 game_design / biz_design / tech_arch / tech_impl / ceo_review' });
  }
  const proposalAuthorValidation = validateAgentIdInput(author_agent_id, 'author_agent_id');
  if (!proposalAuthorValidation.ok) return res.status(400).json({ error: proposalAuthorValidation.error });
  const titleValidation = validateTitleInput(title, 'title');
  if (!titleValidation.ok) return res.status(400).json({ error: titleValidation.error });
  const contentValidation = validateRequiredTextInput(content, 'content');
  if (!contentValidation.ok) return res.status(400).json({ error: contentValidation.error });
  const safeContent = sanitizeHtml(contentValidation.text);

  const now = new Date().toISOString();
  const proposal = db.createProposal({
    id: uuidv4(),
    project_id: projectValidation.projectId,
    type,
    title: titleValidation.title,
    content: safeContent,
    author_agent_id: proposalAuthorValidation.agentId,
    status: 'pending_review',
    reviewer_agent_id: null,
    review_comment: null,
    user_decision: null,
    user_comment: null,
    version: 1,
    parent_id: null,
    source: 'manual',
    created_at: now,
    updated_at: now
  });
  db.ensureProject(proposal.project_id);
  const filePath = db.saveProposalToFile(proposal);
  sseBroadcaster.broadcast({ type: 'proposal_created', proposal, filePath }, proposal.project_id);
  agentManager.addLog(proposal.project_id, proposalAuthorValidation.agentId, '提交提案', `提案: ${proposal.title}${filePath ? ` → 已保存到 ${path.basename(filePath)}` : ''}`, 'success');

  res.json({ proposal, filePath });
});
app.post('/api/proposals/:id/decide', (req, res) => {
  const { id } = req.params;
  const { decision, comment } = req.body;

  if (!decision) return res.status(400).json({ error: '缺少审批决定' });
  if (typeof decision !== 'string' || !USER_DECISIONS.has(decision)) {
    return res.status(400).json({ error: 'decision 仅支持 approved 或 rejected' });
  }
  const commentValidation = validateOptionalTextInput(comment, 'comment');
  if (!commentValidation.ok) return res.status(400).json({ error: commentValidation.error });

  const proposal = db.getProposal(id);
  if (!proposal) return res.status(404).json({ error: '提案不存在' });

  const userDecision = decision === 'approved' ? 'user_approved' : 'user_rejected';
  try {
    db.updateProposal(id, {
      status: userDecision,
      user_decision: decision,
      user_comment: commentValidation.text
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '提案参数不合法' });
  }

  const updated = db.getProposal(id);
  if (!updated) return res.status(500).json({ error: '提案更新后读取失败' });
  const filePath = db.saveProposalToFile(updated);

  sseBroadcaster.broadcast({ type: 'proposal_decided', proposal: updated, decision, comment: commentValidation.text, filePath }, updated.project_id);

  res.json({ success: true, proposal: updated, filePath });
});

// Game submission API.
app.post('/api/games', (req, res) => {
  const { project_id, description, proposal_id, version, file_storage_id } = req.body;
  const missing: string[] = [];
  if (!file_storage_id) missing.push('file_storage_id');
  if (!description) missing.push('description');
  if (missing.length > 0) {
    return res.status(400).json({ error: `缺少必要字段：${missing.join(', ')}` });
  }
  const projectValidation = validateProjectIdInput(project_id, 'project_id');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  if (proposal_id !== undefined && proposal_id !== null && typeof proposal_id !== 'string') {
    return res.status(400).json({ error: 'proposal_id 必须是字符串' });
  }
  if (version !== undefined && version !== null && typeof version !== 'string') {
    return res.status(400).json({ error: 'version 必须是字符串' });
  }
  if (typeof file_storage_id !== 'string' || file_storage_id.trim().length === 0) {
    return res.status(400).json({ error: 'file_storage_id 必填' });
  }

  // 校验 file_storage_id 对应记录存在
  const fileStorageRecord = db.getFileStorage(file_storage_id);
  if (!fileStorageRecord) {
    return res.status(400).json({ error: `file_storage_id 不存在: ${file_storage_id}` });
  }
  // 校验 file_storage_id 属于同一个 project
  if (fileStorageRecord.project_id !== projectValidation.projectId) {
    return res.status(400).json({ error: 'file_storage_id 不属于当前项目' });
  }

  const normalizedVersion = typeof version === 'string' ? version.trim() : undefined;
  const proposalIdValidation = validateOptionalTextInput(proposal_id, 'proposal_id');
  if (!proposalIdValidation.ok) return res.status(400).json({ error: proposalIdValidation.error });
  const descriptionValidation = validateOptionalTextInput(description, 'description');
  if (!descriptionValidation.ok) return res.status(400).json({ error: descriptionValidation.error });
  const normalizedProposalId = proposalIdValidation.text;
  if (normalizedVersion && normalizedVersion.length > MAX_GAME_VERSION_LENGTH) {
    return res.status(400).json({ error: `version 长度不能超过 ${MAX_GAME_VERSION_LENGTH}` });
  }
  const now = new Date().toISOString();
  let game: db.DbGame;
  try {
    game = db.createGame({
      id: uuidv4(),
      project_id: projectValidation.projectId,
      version_number: 0, // 会由数据库自动生成
      description: descriptionValidation.text || '',
      proposal_id: normalizedProposalId,
      version: normalizedVersion || '1.0.0',
      status: 'draft',
      file_storage_id: file_storage_id,
      sonar_storage_id: null,
      created_at: now,
      updated_at: now
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '游戏参数不合法' });
  }
  db.ensureProject(game.project_id);

  sseBroadcaster.broadcast({ type: 'game_submitted', game: { ...game, fileStorageId: game.file_storage_id }, filePath: null }, game.project_id);
  agentManager.addLog(game.project_id, 'api' as AgentRole, '提交游戏', `游戏版本: ${game.version_number} v${game.version} [文件模式]`, 'success');

  res.json({ game, filePath: null });
});

// Boot sequence: synchronize existing state first, then start long-running supervisor loop.
app.listen(PORT, async () => {
  await starOfficeSyncService.syncAllProjectsOnBoot();
  starOfficeSyncService.startSupervisor();

  // 预创建默认 SonarQube 项目，确保 lint 和 submit_game 流程无需判断项目是否存在
  const sonarHost = (process.env.SONARQUBE_HOST || 'http://localhost:9002').replace(/\/$/, '');
  try {
    const token = await globalTokenManager.ensureToken();
    const sonarClient = new SonarQubeClient(sonarHost, token);
    if (await sonarClient.ping()) {
      await sonarClient.ensureProject('game-default', 'Game Default Project');
      console.log('[Boot] SonarQube 默认项目已就绪');
    } else {
      console.warn('[Boot] SonarQube 服务暂不可用，将在后继扫描时重试');
    }
  } catch (err) {
    console.warn('[Boot] SonarQube 启动预检失败:', err);
  }

  // 预创建 MinIO bucket，确保文件上传流程无需判断 bucket 是否存在
  try {
    const { ensureBucket } = await import('./minio-client.js');
    await ensureBucket();
    console.log('[Boot] MinIO bucket 已就绪');
  } catch (err) {
    console.warn('[Boot] MinIO bucket 初始化失败:', err);
  }

  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   🎮  游戏开发 Agent 团队 - 控制中心                  ║
║                                                      ║
║   后端服务: http://localhost:${PORT}                    ║
║   观测系统: http://localhost:5173                     ║
║                                                      ║
║   Agent 团队:                                        ║
║   👨‍💻 软件工程师  🏗️ 架构师  🎮 游戏策划             ║
║   💼 商业策划    👔 CEO                              ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
});
