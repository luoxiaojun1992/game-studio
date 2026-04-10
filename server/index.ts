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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_PROJECT_ID = 'default';
const PROJECT_ID_PATTERN = db.PROJECT_ID_PATTERN;
const MAX_PROJECT_ID_LENGTH = db.MAX_PROJECT_ID_LENGTH;
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
    const q = new Query('', {});
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
    games: db.getAllGames().filter(g => g.project_id === project).map(g => ({ ...g, html_content: undefined })),
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

// Returns recent chat history for one agent within the selected project.
app.get('/api/agents/:agentId/messages', (req, res) => {
  const { agentId } = req.params;
  const agentValidation = validateAgentIdInput(agentId, 'agentId');
  if (!agentValidation.ok) return res.status(400).json({ error: agentValidation.error });
  const projectId = normalizeProjectId(req.query.projectId);
  const messages = db.getAgentMessages(projectId, agentValidation.agentId, 100);
  res.json({ messages: messages.map(m => ({ ...m, tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null })) });
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
  const agentValidation = validateAgentIdInput(agentId, 'agentId');
  if (!agentValidation.ok) return res.status(400).json({ error: agentValidation.error });
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
    executed_at: new Date().toISOString()
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
    created_at: new Date().toISOString()
  });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`data: ${JSON.stringify({ type: 'command_started', commandId, agentId: normalizedAgentId })}\n\n`);

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

  db.updateProposal(id, {
    status: status || 'under_review',
    reviewer_agent_id,
    review_comment
  });

  const updated = db.getProposal(id);
  sseBroadcaster.broadcast({ type: 'proposal_reviewed', proposal: updated }, proposal.project_id);

  if (reviewer_agent_id) {
    agentManager.addLog(proposal.project_id, reviewer_agent_id as AgentRole, '评审提案', `提案: ${proposal.title} → ${status}`, 'info');
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
      autopilot_enabled: settings.autopilot_enabled === 1
    }
  });
});

app.patch('/api/projects/:id/settings', (req, res) => {
  const projectId = normalizeProjectId(req.params.id);
  db.ensureProject(projectId);
  const { autopilot_enabled } = req.body as { autopilot_enabled?: boolean };
  if (autopilot_enabled === undefined) {
    return res.status(400).json({ error: '缺少可更新字段：autopilot_enabled' });
  }
  const settings = db.updateProjectSettings(projectId, {
    autopilot_enabled: autopilot_enabled ? 1 : 0
  });
  res.json({
    settings: {
      project_id: settings.project_id,
      autopilot_enabled: settings.autopilot_enabled === 1
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
  const fromProjectId = typeof req.body?.fromProjectId === 'string' ? req.body.fromProjectId.trim() : null;
  const toProjectId = typeof req.body?.toProjectId === 'string' ? normalizeProjectId(req.body.toProjectId) : null;

  if (!toProjectId) {
    return res.status(400).json({ error: '缺少目标项目ID' });
  }

  try {
    await starOfficeSyncService.switchProject(fromProjectId, toProjectId);
    res.json({ success: true, fromProjectId, toProjectId });
  } catch (error) {
    console.error('[project-switch] Error:', error);
    res.status(500).json({ error: '切换项目失败', details: String(error) });
  }
});

// Game asset and preview APIs.
app.get('/api/games', (req, res) => {
  const projectValidation = validateProjectIdInput(req.query.projectId, 'projectId');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const project = projectValidation.projectId;
  const games = db.getAllGames().filter(g => g.project_id === project).map(g => ({
    ...g,
    html_content: undefined,
    hasContent: !!g.html_content
  }));
  res.json({ games });
});
app.get('/api/games/:id', (req, res) => {
  const game = db.getGame(req.params.id);
  if (!game) return res.status(404).json({ error: '游戏不存在' });
  res.json({ game });
});
app.get('/api/games/:id/preview', (req, res) => {
  const game = db.getGame(req.params.id);
  if (!game) return res.status(404).send('<html><body><h1>游戏不存在</h1></body></html>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(game.html_content);
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
  sseBroadcaster.broadcast({ type: 'game_updated', game: { ...game, html_content: undefined } }, game.project_id);
  res.json({ success: true, game: { ...game, html_content: undefined } });
});

// Audit/log retrieval and maintenance APIs.
app.get('/api/projects/:projectId/logs', (req, res) => {
  const projectId = normalizeProjectId(req.params.projectId);
  const agentId = req.query.agentId as string | undefined;
  const logs = db.getLogs(projectId, agentId, 1000);
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

  const now = new Date().toISOString();
  db.updateHandoff(id, { status: 'completed', result: result || null, completed_at: now });
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

  db.updateHandoff(id, { status: 'rejected', result: reason || '被拒绝' });
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

  const now = new Date().toISOString();
  const updates: Partial<db.DbTaskBoardTask> = {
    status,
    updated_by: updated_by || null
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

  const success = db.updateTaskBoardTask(id, updates);
  if (!success) return res.status(500).json({ error: '任务状态更新失败' });
  const updated = db.getTaskBoardTask(id)!;
  sseBroadcaster.broadcast({ type: 'task_updated', task: updated }, task.project_id);
  agentManager.addLog(task.project_id, (updated_by || task.created_by) as AgentRole, '更新任务状态', `${task.title}: ${task.status} → ${status}`, 'success');
  res.json({ task: updated });
});

// Agent memory APIs.
app.delete('/api/agents/:agentId/messages', (req, res) => {
  const { agentId } = req.params;
  const projectId = normalizeProjectId(req.query.projectId ?? req.body?.projectId);
  db.clearAgentMessages(projectId, agentId);
  agentManager.addLog(projectId, agentId as AgentRole, '清除聊天记录', '用户清除了该 Agent 的所有聊天记录和会话', 'warn');
  res.json({ success: true });
});
app.get('/api/agents/:agentId/memories', (req, res) => {
  const { agentId } = req.params;
  const { category } = req.query;
  const projectId = normalizeProjectId(req.query.projectId);
  const memories = db.getAgentMemories(projectId, agentId, category as string | undefined);
  res.json({ memories });
});
app.get('/api/memories', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId);
  const memories = db.getAllAgentMemories(projectId);
  res.json({ memories });
});
app.post('/api/agents/:agentId/memories', (req, res) => {
  const { agentId } = req.params;
  const { category = 'general', content, importance = 'normal', source_task, projectId: bodyProjectId } = req.body;
  const projectId = normalizeProjectId(req.query.projectId ?? bodyProjectId);

  if (!content) return res.status(400).json({ error: '记忆内容不能为空' });

  const now = new Date().toISOString();
  const memory = db.createAgentMemory({
    id: uuidv4(),
    project_id: projectId,
    agent_id: agentId,
    category,
    content: content.slice(0, 5000),
    importance,
    source_task: source_task || null,
    created_at: now,
    updated_at: now
  });

  agentManager.addLog(projectId, agentId as AgentRole, '保存记忆', `类别: ${category} | 重要度: ${importance}`, 'info');

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
app.use('/output', express.static(path.join(__dirname, '..', 'output'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

// Proposal submission and human-decision APIs.
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

  const now = new Date().toISOString();
  const proposal = db.createProposal({
    id: uuidv4(),
    project_id: projectValidation.projectId,
    type,
    title: titleValidation.title,
    content: contentValidation.text,
    author_agent_id: proposalAuthorValidation.agentId,
    status: 'pending_review',
    reviewer_agent_id: null,
    review_comment: null,
    user_decision: null,
    user_comment: null,
    version: 1,
    parent_id: null,
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

  const proposal = db.getProposal(id);
  if (!proposal) return res.status(404).json({ error: '提案不存在' });

  const userDecision = decision === 'approved' ? 'user_approved' : 'user_rejected';
  db.updateProposal(id, {
    status: userDecision,
    user_decision: decision,
    user_comment: comment || null
  });

  const updated = db.getProposal(id);
  if (!updated) return res.status(500).json({ error: '提案更新后读取失败' });
  const filePath = db.saveProposalToFile(updated);

  sseBroadcaster.broadcast({ type: 'proposal_decided', proposal: updated, decision, comment, filePath }, updated.project_id);

  res.json({ success: true, proposal: updated, filePath });
});

// Game submission API.
app.post('/api/games', (req, res) => {
  const { project_id, name, description, html_content, proposal_id, author_agent_id, version } = req.body;
  const missing: string[] = [];
  if (!name) missing.push('name');
  if (!html_content) missing.push('html_content');
  if (!author_agent_id) missing.push('author_agent_id');
  if (missing.length > 0) {
    return res.status(400).json({ error: `缺少必要字段：${missing.join(', ')}` });
  }
  const nameValidation = validateRequiredTextInput(name, 'name');
  if (!nameValidation.ok) return res.status(400).json({ error: nameValidation.error });
  const htmlValidation = validateRequiredTextInput(html_content, 'html_content');
  if (!htmlValidation.ok) return res.status(400).json({ error: htmlValidation.error });
  const projectValidation = validateProjectIdInput(project_id, 'project_id');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const gameAuthorValidation = validateAgentIdInput(author_agent_id, 'author_agent_id');
  if (!gameAuthorValidation.ok) return res.status(400).json({ error: gameAuthorValidation.error });
  if (proposal_id !== undefined && proposal_id !== null && typeof proposal_id !== 'string') {
    return res.status(400).json({ error: 'proposal_id 必须是字符串' });
  }
  if (version !== undefined && version !== null && typeof version !== 'string') {
    return res.status(400).json({ error: 'version 必须是字符串' });
  }
  const normalizedVersion = typeof version === 'string' ? version.trim() : undefined;
  const proposalIdValidation = validateOptionalTextInput(proposal_id, 'proposal_id');
  if (!proposalIdValidation.ok) return res.status(400).json({ error: proposalIdValidation.error });
  const descriptionValidation = validateOptionalTextInput(description, 'description');
  if (!descriptionValidation.ok) return res.status(400).json({ error: descriptionValidation.error });
  const normalizedProposalId = proposalIdValidation.text;
  const normalizedName = nameValidation.text;
  const originalHtmlContent = typeof html_content === 'string' ? html_content : '';
  const now = new Date().toISOString();
  let game: db.DbGame;
  try {
    game = db.createGame({
      id: uuidv4(),
      project_id: projectValidation.projectId,
      name: normalizedName,
      description: descriptionValidation.text,
      html_content: originalHtmlContent,
      proposal_id: normalizedProposalId,
      version: normalizedVersion || '1.0.0',
      status: 'draft',
      author_agent_id: gameAuthorValidation.agentId,
      created_at: now,
      updated_at: now
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '游戏参数不合法' });
  }
  db.ensureProject(game.project_id);
  const filePath = db.saveGameToFile(game);

  sseBroadcaster.broadcast({ type: 'game_submitted', game: { ...game, html_content: undefined, hasContent: true }, filePath }, game.project_id);
  agentManager.addLog(game.project_id, gameAuthorValidation.agentId, '提交游戏', `游戏: ${game.name} v${game.version}${filePath ? ` → 已保存到 ${path.basename(filePath)}` : ''}`, 'success');

  res.json({ game: { ...game, html_content: undefined }, filePath });
});

// Boot sequence: synchronize existing state first, then start long-running supervisor loop.
app.listen(PORT, async () => {
  await starOfficeSyncService.syncAllProjectsOnBoot();
  starOfficeSyncService.startSupervisor();
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
