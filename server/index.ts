import express from 'express';
import { unstable_v2_authenticate, Query } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';
import { agentManager } from './agent-manager.js';
import { AGENT_DEFINITIONS, getAllAgents, AgentRole } from './agents.js';
import { sseBroadcaster } from './sse-broadcaster.js';
import { starOfficeSyncService } from './star-office-sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_PROJECT_ID = 'default';

const normalizeProjectId = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || DEFAULT_PROJECT_ID;
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

// 将 AgentManager 的事件转发到 SSE
agentManager.on('agent_status_changed', (data) => {
  sseBroadcaster.broadcast({ type: 'agent_status_changed', ...data }, data.projectId);
  starOfficeSyncService.notifyAgentStatusChanged(data.projectId, data.agentId, data.state);
});
agentManager.on('stream_event', (data) => {
  sseBroadcaster.broadcast({ type: 'stream_event', event: data }, (data as any).projectId);
  const streamType = String((data as any)?.type || '');
  const projectId = String((data as any)?.projectId || DEFAULT_PROJECT_ID);
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

// ============= 健康检查 =============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============= 查询可用模型 =============

app.get('/api/models', async (req, res) => {
  try {
    const q = new Query('', {});
    const models = await q.supportedModels();
    res.json({ models: models || [] });
  } catch (error: any) {
    // 如果 SDK 查询失败，返回错误信息
    res.status(500).json({ error: error?.message || '获取模型列表失败', models: [] });
  }
});

// ============= SSE 观测流 =============

app.get('/api/observe', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 发送初始状态
  const project = normalizeProjectId(req.query.projectId);

  const initialState = {
    type: 'init',
    projectId: project,
    agents: agentManager.getAllAgentStates(project),
    proposals: db.getAllProposals().filter(p => p.project_id === project),
    games: db.getAllGames().filter(g => g.project_id === project).map(g => ({ ...g, html_content: undefined })), // 不传 HTML 内容
    logs: db.getLogs(project, undefined, 1000),
    tasks: db.getTaskBoardTasks(project),
    pendingPermissions: agentManager.getPendingPermissions(project)
  };
  res.write(`data: ${JSON.stringify(initialState)}\n\n`);

  sseBroadcaster.addClient(res, project);

  // 心跳
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (e) { clearInterval(heartbeat); sseBroadcaster.removeClient(res); }
  }, 30000);

  req.on('close', () => {
    sseBroadcaster.removeClient(res);
    clearInterval(heartbeat);
  });
});

// ============= 登录检查 =============

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

// ============= Agent 状态 API =============

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

app.get('/api/agents/:agentId/messages', (req, res) => {
  const { agentId } = req.params;
  const projectId = normalizeProjectId(req.query.projectId);
  const messages = db.getAgentMessages(projectId, agentId as AgentRole, 100);
  res.json({ messages: messages.map(m => ({ ...m, tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null })) });
});

// ============= Agent 控制 API =============

// 暂停 Agent
app.post('/api/agents/:agentId/pause', (req, res) => {
  const { agentId } = req.params;
  const projectId = normalizeProjectId(req.query.projectId ?? req.body?.projectId);
  agentManager.pauseAgent(projectId, agentId as AgentRole);
  res.json({ success: true, message: `Agent ${agentId} 已暂停` });
});

// 恢复 Agent
app.post('/api/agents/:agentId/resume', (req, res) => {
  const { agentId } = req.params;
  const projectId = normalizeProjectId(req.query.projectId ?? req.body?.projectId);
  agentManager.resumeAgent(projectId, agentId as AgentRole);
  res.json({ success: true, message: `Agent ${agentId} 已恢复` });
});

// 向 Agent 下达指令
app.post('/api/agents/:agentId/command', async (req, res) => {
  const { agentId } = req.params;
  const { message, model = 'glm-5.0', projectId: bodyProjectId } = req.body;
  const projectId = normalizeProjectId(req.query.projectId ?? bodyProjectId);

  if (!message) return res.status(400).json({ error: '指令内容不能为空' });

  // 保存指令记录
  const commandId = uuidv4();
  const command = db.createCommand({
    id: commandId,
    project_id: projectId,
    target_agent_id: agentId,
    content: message,
    status: 'executing',
    result: null,
    created_at: new Date().toISOString(),
    executed_at: new Date().toISOString()
  });

  // 将用户指令记录到 logs，方便在指令中心显示历史记录
  db.addLog({
    id: uuidv4(),
    project_id: projectId,
    agent_id: agentId,
    log_type: 'user_command',
    level: 'info',
    content: message,
    tool_name: null,
    action: '👤 用户指令',
    is_error: false,
    created_at: new Date().toISOString()
  });

  // 设置 SSE 响应（流式返回）
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`data: ${JSON.stringify({ type: 'command_started', commandId, agentId })}\n\n`);

  try {
    const response = await agentManager.sendMessage(
      projectId,
      agentId as AgentRole,
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

// ============= 提案 API =============

// 获取所有提案
app.get('/api/proposals', (req, res) => {
  const project = normalizeProjectId(req.query.projectId);
  const proposals = db.getAllProposals().filter(p => p.project_id === project);
  res.json({ proposals });
});

// 获取单个提案
app.get('/api/proposals/:id', (req, res) => {
  const proposal = db.getProposal(req.params.id);
  if (!proposal) return res.status(404).json({ error: '提案不存在' });
  res.json({ proposal });
});

// CEO 评审提案（Agent 触发）
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

// ============= 游戏成品 API =============

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

// 获取游戏列表
app.get('/api/games', (req, res) => {
  const project = normalizeProjectId(req.query.projectId);
  const games = db.getAllGames().filter(g => g.project_id === project).map(g => ({
    ...g,
    html_content: undefined,
    hasContent: !!g.html_content
  }));
  res.json({ games });
});

// 获取单个游戏（含 HTML 内容）
app.get('/api/games/:id', (req, res) => {
  const game = db.getGame(req.params.id);
  if (!game) return res.status(404).json({ error: '游戏不存在' });
  res.json({ game });
});

// 游戏 HTML 预览（直接返回 HTML）
app.get('/api/games/:id/preview', (req, res) => {
  const game = db.getGame(req.params.id);
  if (!game) return res.status(404).send('<html><body><h1>游戏不存在</h1></body></html>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(game.html_content);
});

// 更新游戏状态
app.patch('/api/games/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const success = db.updateGame(id, updates);
  if (!success) return res.status(404).json({ error: '游戏不存在' });

  const game = db.getGame(id);
  if (!game) return res.status(500).json({ error: '游戏更新后读取失败' });
  sseBroadcaster.broadcast({ type: 'game_updated', game: { ...game, html_content: undefined } }, game.project_id);
  res.json({ success: true, game: { ...game, html_content: undefined } });
});

// ============= 日志 API =============

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
  res.json({ success: true });
});

// ============= 指令历史 API =============

app.get('/api/commands', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId);
  const commands = db.getAllCommands(projectId);
  res.json({ commands });
});

// ============= 权限响应 API =============

app.post('/api/permission-response', (req, res) => {
  const { requestId, behavior, message, projectId: bodyProjectId, updatedInput } = req.body;
  const projectId = normalizeProjectId(bodyProjectId ?? req.query.projectId);
  const success = agentManager.respondToPermission(requestId, behavior, message, projectId, updatedInput);
  if (!success) return res.status(404).json({ error: '权限请求不存在或已超时' });
  res.json({ success: true });
});

// ============= 任务交接 API =============

// 获取所有交接记录
app.get('/api/handoffs', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId);
  const { agentId, status, limit } = req.query;
  let handoffs;

  if (agentId) {
    const result = db.getHandoffsForAgent(projectId, agentId as string, limit ? parseInt(limit as string) : 20);
    return res.json(result);
  } else if (status) {
    // 按状态筛选
    const all = db.getAllHandoffs(projectId, limit ? parseInt(limit as string) : 50);
    handoffs = all.filter(h => h.status === status);
  } else {
    handoffs = db.getAllHandoffs(projectId, limit ? parseInt(limit as string) : 50);
  }

  res.json({ handoffs });
});

// 获取待处理的交接
app.get('/api/handoffs/pending', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId);
  const { toAgentId } = req.query;
  const handoffs = db.getPendingHandoffs(projectId, toAgentId as string | undefined);
  res.json({ handoffs });
});

// 创建交接（用户手动创建，或 Agent 系统创建）
app.post('/api/handoffs', (req, res) => {
  const { from_agent_id, to_agent_id, title, description, context, priority, source_command_id, project_id } = req.body;
  const projectId = normalizeProjectId(project_id ?? req.query.projectId);

  if (!from_agent_id || !to_agent_id || !title || !description) {
    return res.status(400).json({ error: '缺少必要字段：from_agent_id, to_agent_id, title, description' });
  }

  const now = new Date().toISOString();
  const settings = db.getProjectSettings(projectId);
  const autoHandoffEnabled = settings.autopilot_enabled === 1;
  const handoff = db.createHandoff({
    id: uuidv4(),
    project_id: projectId,
    from_agent_id,
    to_agent_id,
    title,
    description,
    context: context || null,
    status: autoHandoffEnabled ? 'working' : 'pending',
    priority: priority || 'normal',
    result: null,
    accepted_at: autoHandoffEnabled ? now : null,
    completed_at: null,
    source_command_id: source_command_id || null,
    created_at: now,
    updated_at: now,
  });

  // 广播交接事件
  sseBroadcaster.broadcast({ type: 'handoff_created', handoff }, handoff.project_id);

  // 记录日志
  agentManager.addLog(handoff.project_id, from_agent_id as AgentRole, '创建交接', `${from_agent_id} → ${to_agent_id}: ${title}`, 'info');
  if (autoHandoffEnabled) {
    agentManager.addLog(handoff.project_id, to_agent_id as AgentRole, '自动接收交接', `从 ${from_agent_id} 接手: ${title}`, 'success');
    agentManager.addLog(handoff.project_id, to_agent_id as AgentRole, '开始执行交接任务', `${handoff.title}`, 'success');
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

// 接受交接（仅标记接受，不自动执行）
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

// 确认交接并开始执行（用户二次确认后触发）
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

  // 自动向目标 Agent 下发任务
  agentManager.sendMessage(
    handoff.project_id,
    handoff.to_agent_id as AgentRole,
    `【任务交接】你收到了来自 ${handoff.from_agent_id} 的任务交接。\n\n## 任务标题\n${handoff.title}\n\n## 任务描述\n${handoff.description}\n\n${handoff.context ? `## 上下文信息\n${handoff.context}\n\n` : ''}请按照上述要求完成任务。完成后请提交相关成果。`
  ).catch(error => {
    agentManager.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '交接任务执行失败', error?.message || String(error), 'error');
  });

  res.json({ handoff: updated });
});

// 完成交接（目标 Agent 完成任务）
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

// 拒绝交接
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

// 取消交接
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

// ============= 任务看板 API =============

const TASK_STATUS_FLOW: Record<string, string[]> = {
  todo: ['developing', 'blocked'],
  developing: ['testing', 'blocked'],
  testing: ['done', 'blocked', 'developing'],
  blocked: ['todo', 'developing', 'testing'],
  done: []
};

app.get('/api/tasks', (req, res) => {
  const { projectId } = req.query;
  const tasks = db.getTaskBoardTasks(projectId as string | undefined);
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

  if (!title || !task_type || !created_by) {
    return res.status(400).json({ error: '缺少必要字段：title, task_type, created_by' });
  }
  if (!['development', 'testing'].includes(task_type)) {
    return res.status(400).json({ error: 'task_type 仅支持 development 或 testing' });
  }

  const now = new Date().toISOString();
  const task = db.createTaskBoardTask({
    id: uuidv4(),
    project_id: project_id || 'default',
    title: String(title).trim(),
    description: description ? String(description).trim() : null,
    task_type,
    status: 'todo',
    source_task_id: null,
    created_by,
    updated_by: created_by,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now
  });

  sseBroadcaster.broadcast({ type: 'task_created', task }, task.project_id);
  agentManager.addLog(task.project_id, created_by as AgentRole, '创建看板任务', `${task_type === 'development' ? '开发' : '测试'}任务: ${task.title}`, 'info');

  let testingTask: db.DbTaskBoardTask | null = null;
  if (split_testing_task && task_type === 'development') {
    testingTask = db.createTaskBoardTask({
      id: uuidv4(),
      project_id: project_id || 'default',
      title: `${String(title).trim()}（测试）`,
      description: description ? `由开发任务拆分：${String(description).trim()}` : '由开发任务自动拆分的测试任务',
      task_type: 'testing',
      status: 'todo',
      source_task_id: task.id,
      created_by,
      updated_by: created_by,
      started_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now
    });
    sseBroadcaster.broadcast({ type: 'task_created', task: testingTask }, testingTask.project_id);
    agentManager.addLog(testingTask.project_id, created_by as AgentRole, '拆分测试任务', `从开发任务拆分测试任务: ${testingTask.title}`, 'info');
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

// ============= Agent 消息 API =============

// 清除 Agent 聊天记录
app.delete('/api/agents/:agentId/messages', (req, res) => {
  const { agentId } = req.params;
  const projectId = normalizeProjectId(req.query.projectId ?? req.body?.projectId);
  db.clearAgentMessages(projectId, agentId);
  agentManager.addLog(projectId, agentId as AgentRole, '清除聊天记录', '用户清除了该 Agent 的所有聊天记录和会话', 'warn');
  res.json({ success: true });
});

// ============= Agent 长期记忆 API =============

// 获取 Agent 记忆
app.get('/api/agents/:agentId/memories', (req, res) => {
  const { agentId } = req.params;
  const { category } = req.query;
  const projectId = normalizeProjectId(req.query.projectId);
  const memories = db.getAgentMemories(projectId, agentId, category as string | undefined);
  res.json({ memories });
});

// 获取所有 Agent 记忆
app.get('/api/memories', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId);
  const memories = db.getAllAgentMemories(projectId);
  res.json({ memories });
});

// 保存 Agent 记忆（Agent 通过 API 自主保存）
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
    content: content.slice(0, 5000), // 限制长度
    importance,
    source_task: source_task || null,
    created_at: now,
    updated_at: now
  });

  agentManager.addLog(projectId, agentId as AgentRole, '保存记忆', `类别: ${category} | 重要度: ${importance}`, 'info');

  res.json({ memory });
});

// 删除单条记忆
app.delete('/api/memories/:id', (req, res) => {
  const success = db.deleteAgentMemory(req.params.id);
  if (!success) return res.status(404).json({ error: '记忆不存在' });
  res.json({ success: true });
});

// 清除 Agent 全部记忆
app.delete('/api/agents/:agentId/memories', (req, res) => {
  const projectId = normalizeProjectId(req.query.projectId ?? req.body?.projectId);
  db.clearAgentMemories(projectId, req.params.agentId);
  res.json({ success: true });
});

// ============= 产出目录静态服务 =============

// 确保产出目录存在
db.ensureOutputDir();

// 提供产出目录的静态文件访问
app.use('/output', express.static(path.join(__dirname, '..', 'output'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

// ============= 提案创建时同步保存到产出目录 =============

// 覆盖创建提案的逻辑，增加文件保存
app.post('/api/proposals', (req, res) => {
  const { project_id, type, title, content, author_agent_id } = req.body;
  if (!type || !title || !content || !author_agent_id) {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  const now = new Date().toISOString();
  const proposal = db.createProposal({
    id: uuidv4(),
    project_id: project_id || 'default',
    type,
    title,
    content,
    author_agent_id,
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

  // 同时保存到产出目录
  const filePath = db.saveProposalToFile(proposal);

  // 通知观测系统
  sseBroadcaster.broadcast({ type: 'proposal_created', proposal, filePath }, proposal.project_id);

  // 记录日志
  agentManager.addLog(proposal.project_id, author_agent_id as AgentRole, '提交提案', `提案: ${title}${filePath ? ` → 已保存到 ${path.basename(filePath)}` : ''}`, 'success');

  res.json({ proposal, filePath });
});

// 用户审批提案时也保存最终版本
app.post('/api/proposals/:id/decide', (req, res) => {
  const { id } = req.params;
  const { decision, comment } = req.body;

  if (!decision) return res.status(400).json({ error: '缺少审批决定' });

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

  // 审批后保存最终版到产出目录
  const filePath = db.saveProposalToFile(updated);

  sseBroadcaster.broadcast({ type: 'proposal_decided', proposal: updated, decision, comment, filePath }, updated.project_id);

  res.json({ success: true, proposal: updated, filePath });
});

// 覆盖游戏提交，增加文件保存
app.post('/api/games', (req, res) => {
  const { project_id, name, description, html_content, proposal_id, author_agent_id, version } = req.body;
  if (!name || !html_content || !author_agent_id) {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  const now = new Date().toISOString();
  const game = db.createGame({
    id: uuidv4(),
    project_id: project_id || 'default',
    name,
    description: description || null,
    html_content,
    proposal_id: proposal_id || null,
    version: version || '1.0.0',
    status: 'draft',
    author_agent_id,
    created_at: now,
    updated_at: now
  });
  db.ensureProject(game.project_id);

  // 同时保存到产出目录
  const filePath = db.saveGameToFile(game);

  sseBroadcaster.broadcast({ type: 'game_submitted', game: { ...game, html_content: undefined, hasContent: true }, filePath }, game.project_id);
  agentManager.addLog(game.project_id, author_agent_id as AgentRole, '提交游戏', `游戏: ${name} v${version || '1.0.0'}${filePath ? ` → 已保存到 ${path.basename(filePath)}` : ''}`, 'success');

  res.json({ game: { ...game, html_content: undefined }, filePath });
});

// ============= 启动服务器 =============

app.listen(PORT, () => {
  starOfficeSyncService.syncAllProjectsOnBoot();
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
