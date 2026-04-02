import express from 'express';
import { unstable_v2_authenticate, Query } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';
import { agentManager } from './agent-manager.js';
import { AGENT_DEFINITIONS, getAllAgents, AgentRole } from './agents.js';
import { sseBroadcaster } from './sse-broadcaster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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
agentManager.on('agent_status_changed', (data) => sseBroadcaster.broadcast({ type: 'agent_status_changed', ...data }));
agentManager.on('agent_log', (data) => sseBroadcaster.broadcast({ type: 'agent_log', ...data }));
agentManager.on('stream_event', (data) => sseBroadcaster.broadcast({ type: 'stream_event', event: data }));
agentManager.on('agent_paused', (data) => sseBroadcaster.broadcast({ type: 'agent_paused', ...data }));
agentManager.on('agent_resumed', (data) => sseBroadcaster.broadcast({ type: 'agent_resumed', ...data }));

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
  const initialState = {
    type: 'init',
    agents: agentManager.getAllAgentStates(),
    proposals: db.getAllProposals(),
    games: db.getAllGames().map(g => ({ ...g, html_content: undefined })), // 不传 HTML 内容
    logs: db.getAgentLogs(undefined, 50),
    pendingPermissions: agentManager.getPendingPermissions()
  };
  res.write(`data: ${JSON.stringify(initialState)}\n\n`);

  sseBroadcaster.addClient(res);

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
  const definitions = getAllAgents();
  const states = agentManager.getAllAgentStates();
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
  const messages = db.getAgentMessages(agentId as AgentRole, 100);
  res.json({ messages: messages.map(m => ({ ...m, tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null })) });
});

// ============= Agent 控制 API =============

// 暂停 Agent
app.post('/api/agents/:agentId/pause', (req, res) => {
  const { agentId } = req.params;
  agentManager.pauseAgent(agentId as AgentRole);
  res.json({ success: true, message: `Agent ${agentId} 已暂停` });
});

// 恢复 Agent
app.post('/api/agents/:agentId/resume', (req, res) => {
  const { agentId } = req.params;
  agentManager.resumeAgent(agentId as AgentRole);
  res.json({ success: true, message: `Agent ${agentId} 已恢复` });
});

// 向 Agent 下达指令
app.post('/api/agents/:agentId/command', async (req, res) => {
  const { agentId } = req.params;
  const { message, model = 'glm-5.0' } = req.body;

  if (!message) return res.status(400).json({ error: '指令内容不能为空' });

  // 保存指令记录
  const commandId = uuidv4();
  const command = db.createCommand({
    id: commandId,
    target_agent_id: agentId,
    content: message,
    status: 'executing',
    result: null,
    created_at: new Date().toISOString(),
    executed_at: new Date().toISOString()
  });

  // 设置 SSE 响应（流式返回）
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`data: ${JSON.stringify({ type: 'command_started', commandId, agentId })}\n\n`);

  try {
    const response = await agentManager.sendMessage(
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
  const proposals = db.getAllProposals();
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
  sseBroadcaster.broadcast({ type: 'proposal_reviewed', proposal: updated });

  if (reviewer_agent_id) {
    agentManager.addLog(reviewer_agent_id as AgentRole, '评审提案', `提案: ${proposal.title} → ${status}`, 'info');
  }

  res.json({ success: true, proposal: updated });
});

// ============= 游戏成品 API =============

// 获取游戏列表
app.get('/api/games', (req, res) => {
  const games = db.getAllGames().map(g => ({
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
  sseBroadcaster.broadcast({ type: 'game_updated', game: { ...game, html_content: undefined } });
  res.json({ success: true, game: { ...game, html_content: undefined } });
});

// ============= 日志 API =============

app.get('/api/logs', (req, res) => {
  const { agentId, limit } = req.query;
  const logs = db.getAgentLogs(agentId as string | undefined, limit ? parseInt(limit as string) : 100);
  res.json({ logs });
});

// ============= 指令历史 API =============

app.get('/api/commands', (req, res) => {
  const commands = db.getAllCommands();
  res.json({ commands });
});

// ============= 权限响应 API =============

app.post('/api/permission-response', (req, res) => {
  const { requestId, behavior, message } = req.body;
  const success = agentManager.respondToPermission(requestId, behavior, message);
  if (!success) return res.status(404).json({ error: '权限请求不存在或已超时' });
  res.json({ success: true });
});

// ============= 任务交接 API =============

// 获取所有交接记录
app.get('/api/handoffs', (req, res) => {
  const { agentId, status, limit } = req.query;
  let handoffs;

  if (agentId) {
    const result = db.getHandoffsForAgent(agentId as string, limit ? parseInt(limit as string) : 20);
    return res.json(result);
  } else if (status) {
    // 按状态筛选
    const all = db.getAllHandoffs(limit ? parseInt(limit as string) : 50);
    handoffs = all.filter(h => h.status === status);
  } else {
    handoffs = db.getAllHandoffs(limit ? parseInt(limit as string) : 50);
  }

  res.json({ handoffs });
});

// 获取待处理的交接
app.get('/api/handoffs/pending', (req, res) => {
  const { toAgentId } = req.query;
  const handoffs = db.getPendingHandoffs(toAgentId as string | undefined);
  res.json({ handoffs });
});

// 创建交接（用户手动创建，或 Agent 系统创建）
app.post('/api/handoffs', (req, res) => {
  const { from_agent_id, to_agent_id, title, description, context, priority, source_command_id } = req.body;

  if (!from_agent_id || !to_agent_id || !title || !description) {
    return res.status(400).json({ error: '缺少必要字段：from_agent_id, to_agent_id, title, description' });
  }

  const now = new Date().toISOString();
  const handoff = db.createHandoff({
    id: uuidv4(),
    from_agent_id,
    to_agent_id,
    title,
    description,
    context: context || null,
    status: 'pending',
    priority: priority || 'normal',
    result: null,
    accepted_at: null,
    completed_at: null,
    source_command_id: source_command_id || null,
    created_at: now,
    updated_at: now,
  });

  // 广播交接事件
  sseBroadcaster.broadcast({ type: 'handoff_created', handoff });

  // 记录日志
  agentManager.addLog(from_agent_id as AgentRole, '创建交接', `${from_agent_id} → ${to_agent_id}: ${title}`, 'info');

  res.json({ handoff });
});

// 接受交接（仅标记接受，不自动执行）
app.post('/api/handoffs/:id/accept', (req, res) => {
  const { id } = req.params;
  const handoff = db.getHandoff(id);
  if (!handoff) return res.status(404).json({ error: '交接记录不存在' });
  if (handoff.status !== 'pending') {
    return res.status(400).json({ error: `交接状态不是待处理，当前状态: ${handoff.status}` });
  }

  const now = new Date().toISOString();
  db.updateHandoff(id, { status: 'accepted', accepted_at: now });
  const updated = db.getHandoff(id)!;

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated });
  agentManager.addLog(handoff.to_agent_id as AgentRole, '接受交接', `从 ${handoff.from_agent_id} 接手: ${handoff.title}`, 'success');

  res.json({ handoff: updated });
});

// 确认交接并开始执行（用户二次确认后触发）
app.post('/api/handoffs/:id/confirm', (req, res) => {
  const { id } = req.params;
  const handoff = db.getHandoff(id);
  if (!handoff) return res.status(404).json({ error: '交接记录不存在' });
  if (handoff.status !== 'accepted') {
    return res.status(400).json({ error: `交接状态不是已接受，当前状态: ${handoff.status}，需要先接受交接` });
  }

  const now = new Date().toISOString();
  db.updateHandoff(id, { status: 'working' });
  const updated = db.getHandoff(id)!;

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated });
  agentManager.addLog(handoff.to_agent_id as AgentRole, '开始执行交接任务', `${handoff.title}`, 'success');

  // 自动向目标 Agent 下发任务
  agentManager.sendMessage(
    handoff.to_agent_id as AgentRole,
    `【任务交接】你收到了来自 ${handoff.from_agent_id} 的任务交接。\n\n## 任务标题\n${handoff.title}\n\n## 任务描述\n${handoff.description}\n\n${handoff.context ? `## 上下文信息\n${handoff.context}\n\n` : ''}请按照上述要求完成任务。完成后请提交相关成果。`
  ).catch(error => {
    agentManager.addLog(handoff.to_agent_id as AgentRole, '交接任务执行失败', error?.message || String(error), 'error');
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

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated });
  agentManager.addLog(handoff.to_agent_id as AgentRole, '完成交接任务', `完成: ${handoff.title}`, 'success');
  agentManager.addLog(handoff.from_agent_id as AgentRole, '交接任务已完成', `${handoff.to_agent_id} 完成了: ${handoff.title}`, 'info');

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

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated });
  agentManager.addLog(handoff.to_agent_id as AgentRole, '拒绝交接', `拒绝来自 ${handoff.from_agent_id} 的: ${handoff.title}`, 'warn');
  agentManager.addLog(handoff.from_agent_id as AgentRole, '交接被拒绝', `${handoff.to_agent_id} 拒绝了: ${handoff.title}`, 'warn');

  res.json({ handoff: updated });
});

// 取消交接
app.post('/api/handoffs/:id/cancel', (req, res) => {
  const { id } = req.params;
  const handoff = db.getHandoff(id);
  if (!handoff) return res.status(404).json({ error: '交接记录不存在' });

  db.updateHandoff(id, { status: 'cancelled' });
  const updated = db.getHandoff(id)!;

  sseBroadcaster.broadcast({ type: 'handoff_updated', handoff: updated });
  agentManager.addLog(handoff.from_agent_id as AgentRole, '取消交接', `取消了: ${handoff.title}`, 'warn');

  res.json({ handoff: updated });
});

// ============= Agent 消息 API =============

// 清除 Agent 聊天记录
app.delete('/api/agents/:agentId/messages', (req, res) => {
  const { agentId } = req.params;
  db.clearAgentMessages(agentId);
  agentManager.addLog(agentId as AgentRole, '清除聊天记录', '用户清除了该 Agent 的所有聊天记录和会话', 'warn');
  res.json({ success: true });
});

// ============= Agent 长期记忆 API =============

// 获取 Agent 记忆
app.get('/api/agents/:agentId/memories', (req, res) => {
  const { agentId } = req.params;
  const { category } = req.query;
  const memories = db.getAgentMemories(agentId, category as string | undefined);
  res.json({ memories });
});

// 获取所有 Agent 记忆
app.get('/api/memories', (req, res) => {
  const memories = db.getAllAgentMemories();
  res.json({ memories });
});

// 保存 Agent 记忆（Agent 通过 API 自主保存）
app.post('/api/agents/:agentId/memories', (req, res) => {
  const { agentId } = req.params;
  const { category = 'general', content, importance = 'normal', source_task } = req.body;

  if (!content) return res.status(400).json({ error: '记忆内容不能为空' });

  const now = new Date().toISOString();
  const memory = db.createAgentMemory({
    id: uuidv4(),
    agent_id: agentId,
    category,
    content: content.slice(0, 5000), // 限制长度
    importance,
    source_task: source_task || null,
    created_at: now,
    updated_at: now
  });

  agentManager.addLog(agentId as AgentRole, '保存记忆', `类别: ${category} | 重要度: ${importance}`, 'info');

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
  db.clearAgentMemories(req.params.agentId);
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

  // 同时保存到产出目录
  const filePath = db.saveProposalToFile(proposal);

  // 通知观测系统
  sseBroadcaster.broadcast({ type: 'proposal_created', proposal, filePath });

  // 记录日志
  agentManager.addLog(author_agent_id as AgentRole, '提交提案', `提案: ${title}${filePath ? ` → 已保存到 ${path.basename(filePath)}` : ''}`, 'success');

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

  sseBroadcaster.broadcast({ type: 'proposal_decided', proposal: updated, decision, comment, filePath });

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

  // 同时保存到产出目录
  const filePath = db.saveGameToFile(game);

  sseBroadcaster.broadcast({ type: 'game_submitted', game: { ...game, html_content: undefined, hasContent: true }, filePath });
  agentManager.addLog(author_agent_id as AgentRole, '提交游戏', `游戏: ${name} v${version || '1.0.0'}${filePath ? ` → 已保存到 ${path.basename(filePath)}` : ''}`, 'success');

  res.json({ game: { ...game, html_content: undefined }, filePath });
});

// ============= 启动服务器 =============

app.listen(PORT, () => {
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
