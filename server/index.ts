import express from 'express';
import { unstable_v2_authenticate } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';
import { agentManager } from './agent-manager.js';
import { AGENT_DEFINITIONS, getAllAgents, AgentRole } from './agents.js';

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

// SSE 客户端列表（观测系统用）
const sseClients = new Set<express.Response>();

// 广播 SSE 事件到所有观测客户端
function broadcastSSE(event: object): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch (e) { sseClients.delete(client); }
  }
}

// 将 AgentManager 的事件转发到 SSE
agentManager.on('agent_status_changed', (data) => broadcastSSE({ type: 'agent_status_changed', ...data }));
agentManager.on('agent_log', (data) => broadcastSSE({ type: 'agent_log', ...data }));
agentManager.on('stream_event', (data) => broadcastSSE({ type: 'stream_event', event: data }));
agentManager.on('agent_paused', (data) => broadcastSSE({ type: 'agent_paused', ...data }));
agentManager.on('agent_resumed', (data) => broadcastSSE({ type: 'agent_resumed', ...data }));

// ============= 健康检查 =============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

  sseClients.add(res);

  // 心跳
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (e) { clearInterval(heartbeat); sseClients.delete(res); }
  }, 30000);

  req.on('close', () => {
    sseClients.delete(res);
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
  const { message, model = 'claude-sonnet-4' } = req.body;

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
        // 同时广播到观测系统
        broadcastSSE({ type: 'stream_event', event });
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

// 创建提案（Agent 提交）
app.post('/api/proposals', (req, res) => {
  const { type, title, content, author_agent_id } = req.body;
  if (!type || !title || !content || !author_agent_id) {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  const now = new Date().toISOString();
  const proposal = db.createProposal({
    id: uuidv4(),
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

  // 通知观测系统
  broadcastSSE({ type: 'proposal_created', proposal });

  // 记录日志
  agentManager.addLog(author_agent_id as AgentRole, '提交提案', `提案: ${title}`, 'success');

  res.json({ proposal });
});

// 用户审批提案
app.post('/api/proposals/:id/decide', (req, res) => {
  const { id } = req.params;
  const { decision, comment } = req.body; // decision: 'approved' | 'rejected'

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

  // 通知观测系统
  broadcastSSE({ type: 'proposal_decided', proposal: updated, decision, comment });

  res.json({ success: true, proposal: updated });
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
  broadcastSSE({ type: 'proposal_reviewed', proposal: updated });

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
    html_content: undefined, // 列表不返回 HTML 内容
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

// 提交游戏（Agent 提交）
app.post('/api/games', (req, res) => {
  const { name, description, html_content, proposal_id, author_agent_id, version } = req.body;
  if (!name || !html_content || !author_agent_id) {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  const now = new Date().toISOString();
  const game = db.createGame({
    id: uuidv4(),
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

  // 通知观测系统
  broadcastSSE({ type: 'game_submitted', game: { ...game, html_content: undefined, hasContent: true } });
  agentManager.addLog(author_agent_id as AgentRole, '提交游戏', `游戏: ${name} v${version || '1.0.0'}`, 'success');

  res.json({ game: { ...game, html_content: undefined } });
});

// 更新游戏状态
app.patch('/api/games/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const success = db.updateGame(id, updates);
  if (!success) return res.status(404).json({ error: '游戏不存在' });

  const game = db.getGame(id);
  broadcastSSE({ type: 'game_updated', game: { ...game, html_content: undefined } });
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
