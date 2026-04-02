import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'studio.db');

// 确保 data 目录存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 初始化数据库表
db.exec(`
  -- Agent 会话表（每个Agent有自己的独立会话）
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    sdk_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    current_task TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Agent 消息表
  CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    agent_session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    tool_calls TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (agent_session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
  );

  -- 提案表（策划案、架构方案、技术方案等）
  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_review',
    reviewer_agent_id TEXT,
    review_comment TEXT,
    user_decision TEXT,
    user_comment TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    parent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 游戏成品表
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    html_content TEXT NOT NULL,
    proposal_id TEXT,
    version TEXT NOT NULL DEFAULT '1.0.0',
    status TEXT NOT NULL DEFAULT 'draft',
    author_agent_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Agent 日志表（操作记录）
  CREATE TABLE IF NOT EXISTS agent_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    level TEXT NOT NULL DEFAULT 'info',
    created_at TEXT NOT NULL
  );

  -- 指令表（用户向Agent下达的指令）
  CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    target_agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at TEXT NOT NULL,
    executed_at TEXT
  );

  -- 任务交接表（Agent之间的任务传递）
  CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    context TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'normal',
    result TEXT,
    accepted_at TEXT,
    completed_at TEXT,
    source_command_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(agent_session_id);
  CREATE INDEX IF NOT EXISTS idx_agent_messages_agent ON agent_messages(agent_id);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
  CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);
  CREATE INDEX IF NOT EXISTS idx_handoffs_to_agent ON handoffs(to_agent_id);

  -- Agent 长期记忆表（Agent 自主保存的重要信息）
  CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    importance TEXT NOT NULL DEFAULT 'normal',
    source_task TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_memories_category ON agent_memories(category);
`);

// ============= 类型定义 =============

export interface DbAgentSession {
  id: string;
  agent_id: string;
  sdk_session_id: string | null;
  status: 'idle' | 'working' | 'paused' | 'error';
  current_task: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAgentMessage {
  id: string;
  agent_session_id: string;
  agent_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  tool_calls: string | null;
  created_at: string;
}

export interface DbProposal {
  id: string;
  type: 'game_design' | 'biz_design' | 'tech_arch' | 'tech_impl' | 'ceo_review';
  title: string;
  content: string;
  author_agent_id: string;
  status: 'pending_review' | 'under_review' | 'approved' | 'rejected' | 'revision_needed' | 'user_approved' | 'user_rejected';
  reviewer_agent_id: string | null;
  review_comment: string | null;
  user_decision: string | null;
  user_comment: string | null;
  version: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbGame {
  id: string;
  name: string;
  description: string | null;
  html_content: string;
  proposal_id: string | null;
  version: string;
  status: 'draft' | 'published';
  author_agent_id: string;
  created_at: string;
  updated_at: string;
}

export interface DbAgentLog {
  id: string;
  agent_id: string;
  action: string;
  detail: string | null;
  level: 'info' | 'warn' | 'error' | 'success';
  created_at: string;
}

export interface DbCommand {
  id: string;
  target_agent_id: string;
  content: string;
  status: 'pending' | 'executing' | 'done' | 'failed';
  result: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface DbHandoff {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  title: string;
  description: string;
  context: string | null;
  status: 'pending' | 'accepted' | 'working' | 'completed' | 'rejected' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  result: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  source_command_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAgentMemory {
  id: string;
  agent_id: string;
  category: 'general' | 'preference' | 'decision' | 'lesson' | 'achievement';
  content: string;
  importance: 'low' | 'normal' | 'high' | 'critical';
  source_task: string | null;
  created_at: string;
  updated_at: string;
}

// ============= Agent 会话操作 =============

export function getAgentSession(agentId: string): DbAgentSession | undefined {
  const stmt = db.prepare('SELECT * FROM agent_sessions WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 1');
  return stmt.get(agentId) as DbAgentSession | undefined;
}

export function getAllAgentSessions(): DbAgentSession[] {
  const stmt = db.prepare('SELECT * FROM agent_sessions ORDER BY updated_at DESC');
  return stmt.all() as DbAgentSession[];
}

export function upsertAgentSession(session: DbAgentSession): DbAgentSession {
  const existing = getAgentSession(session.agent_id);
  if (existing) {
    const stmt = db.prepare(`
      UPDATE agent_sessions SET
        sdk_session_id = ?, status = ?, current_task = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(session.sdk_session_id, session.status, session.current_task, new Date().toISOString(), existing.id);
    return { ...existing, ...session, id: existing.id };
  } else {
    const stmt = db.prepare(`
      INSERT INTO agent_sessions (id, agent_id, sdk_session_id, status, current_task, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(session.id, session.agent_id, session.sdk_session_id, session.status, session.current_task, session.created_at, session.updated_at);
    return session;
  }
}

export function updateAgentStatus(agentId: string, status: DbAgentSession['status'], currentTask?: string | null): void {
  const existing = getAgentSession(agentId);
  if (existing) {
    const stmt = db.prepare('UPDATE agent_sessions SET status = ?, current_task = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, currentTask !== undefined ? currentTask : existing.current_task, new Date().toISOString(), existing.id);
  }
}

// ============= Agent 消息操作 =============

export function getAgentMessages(agentId: string, limit = 50): DbAgentMessage[] {
  const session = getAgentSession(agentId);
  if (!session) return [];
  const stmt = db.prepare('SELECT * FROM agent_messages WHERE agent_session_id = ? ORDER BY created_at ASC LIMIT ?');
  return stmt.all(session.id, limit) as DbAgentMessage[];
}

export function createAgentMessage(message: DbAgentMessage): DbAgentMessage {
  const stmt = db.prepare(`
    INSERT INTO agent_messages (id, agent_session_id, agent_id, role, content, model, tool_calls, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(message.id, message.agent_session_id, message.agent_id, message.role, message.content, message.model, message.tool_calls, message.created_at);
  return message;
}

// ============= 提案操作 =============

export function getAllProposals(): DbProposal[] {
  const stmt = db.prepare('SELECT * FROM proposals ORDER BY created_at DESC');
  return stmt.all() as DbProposal[];
}

export function getProposal(id: string): DbProposal | undefined {
  const stmt = db.prepare('SELECT * FROM proposals WHERE id = ?');
  return stmt.get(id) as DbProposal | undefined;
}

export function createProposal(proposal: DbProposal): DbProposal {
  const stmt = db.prepare(`
    INSERT INTO proposals (id, type, title, content, author_agent_id, status, reviewer_agent_id, review_comment, user_decision, user_comment, version, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(proposal.id, proposal.type, proposal.title, proposal.content, proposal.author_agent_id, proposal.status, proposal.reviewer_agent_id, proposal.review_comment, proposal.user_decision, proposal.user_comment, proposal.version, proposal.parent_id, proposal.created_at, proposal.updated_at);
  return proposal;
}

export function updateProposal(id: string, updates: Partial<DbProposal>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbProposal)[] = ['status', 'reviewer_agent_id', 'review_comment', 'user_decision', 'user_comment', 'content', 'title'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const stmt = db.prepare(`UPDATE proposals SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// ============= 游戏操作 =============

export function getAllGames(): DbGame[] {
  const stmt = db.prepare('SELECT * FROM games ORDER BY created_at DESC');
  return stmt.all() as DbGame[];
}

export function getGame(id: string): DbGame | undefined {
  const stmt = db.prepare('SELECT * FROM games WHERE id = ?');
  return stmt.get(id) as DbGame | undefined;
}

export function createGame(game: DbGame): DbGame {
  const stmt = db.prepare(`
    INSERT INTO games (id, name, description, html_content, proposal_id, version, status, author_agent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(game.id, game.name, game.description, game.html_content, game.proposal_id, game.version, game.status, game.author_agent_id, game.created_at, game.updated_at);
  return game;
}

export function updateGame(id: string, updates: Partial<DbGame>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbGame)[] = ['name', 'description', 'html_content', 'status', 'version'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const stmt = db.prepare(`UPDATE games SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// ============= 日志操作 =============

export function addAgentLog(log: DbAgentLog): void {
  const stmt = db.prepare(`
    INSERT INTO agent_logs (id, agent_id, action, detail, level, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(log.id, log.agent_id, log.action, log.detail, log.level, log.created_at);
}

export function getAgentLogs(agentId?: string, limit = 100): DbAgentLog[] {
  if (agentId) {
    const stmt = db.prepare('SELECT * FROM agent_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(agentId, limit) as DbAgentLog[];
  } else {
    const stmt = db.prepare('SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit) as DbAgentLog[];
  }
}

// ============= 指令操作 =============

export function createCommand(command: DbCommand): DbCommand {
  const stmt = db.prepare(`
    INSERT INTO commands (id, target_agent_id, content, status, result, created_at, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(command.id, command.target_agent_id, command.content, command.status, command.result, command.created_at, command.executed_at);
  return command;
}

export function getPendingCommands(agentId: string): DbCommand[] {
  const stmt = db.prepare("SELECT * FROM commands WHERE target_agent_id = ? AND status = 'pending' ORDER BY created_at ASC");
  return stmt.all(agentId) as DbCommand[];
}

export function updateCommand(id: string, updates: Partial<DbCommand>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.result !== undefined) { fields.push('result = ?'); values.push(updates.result); }
  if (updates.executed_at !== undefined) { fields.push('executed_at = ?'); values.push(updates.executed_at); }
  if (fields.length === 0) return false;
  values.push(id);
  const stmt = db.prepare(`UPDATE commands SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function getAllCommands(limit = 50): DbCommand[] {
  const stmt = db.prepare('SELECT * FROM commands ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as DbCommand[];
}

// ============= 任务交接操作 =============

export function createHandoff(handoff: DbHandoff): DbHandoff {
  const stmt = db.prepare(`
    INSERT INTO handoffs (id, from_agent_id, to_agent_id, title, description, context, status, priority, result, accepted_at, completed_at, source_command_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(handoff.id, handoff.from_agent_id, handoff.to_agent_id, handoff.title, handoff.description, handoff.context, handoff.status, handoff.priority, handoff.result, handoff.accepted_at, handoff.completed_at, handoff.source_command_id, handoff.created_at, handoff.updated_at);
  return handoff;
}

export function getHandoff(id: string): DbHandoff | undefined {
  const stmt = db.prepare('SELECT * FROM handoffs WHERE id = ?');
  return stmt.get(id) as DbHandoff | undefined;
}

export function getAllHandoffs(limit = 50): DbHandoff[] {
  const stmt = db.prepare('SELECT * FROM handoffs ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as DbHandoff[];
}

export function getPendingHandoffs(toAgentId?: string): DbHandoff[] {
  if (toAgentId) {
    const stmt = db.prepare("SELECT * FROM handoffs WHERE to_agent_id = ? AND status IN ('pending', 'accepted', 'working') ORDER BY created_at DESC");
    return stmt.all(toAgentId) as DbHandoff[];
  }
  const stmt = db.prepare("SELECT * FROM handoffs WHERE status IN ('pending', 'accepted', 'working') ORDER BY created_at DESC");
  return stmt.all() as DbHandoff[];
}

export function getHandoffsForAgent(agentId: string, limit = 20): { incoming: DbHandoff[]; outgoing: DbHandoff[] } {
  const incoming = db.prepare("SELECT * FROM handoffs WHERE to_agent_id = ? ORDER BY created_at DESC LIMIT ?").all(agentId, limit) as DbHandoff[];
  const outgoing = db.prepare("SELECT * FROM handoffs WHERE from_agent_id = ? ORDER BY created_at DESC LIMIT ?").all(agentId, limit) as DbHandoff[];
  return { incoming, outgoing };
}

export function updateHandoff(id: string, updates: Partial<DbHandoff>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbHandoff)[] = ['status', 'result', 'accepted_at', 'completed_at', 'description', 'context', 'priority'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const stmt = db.prepare(`UPDATE handoffs SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// ============= 清除消息操作 =============

/**
 * 清除指定 Agent 的所有消息和会话，重置 SDK session
 */
export function clearAgentMessages(agentId: string): boolean {
  const session = getAgentSession(agentId);
  if (!session) return true;

  // 删除该会话的所有消息
  const deleteMsgs = db.prepare('DELETE FROM agent_messages WHERE agent_session_id = ?');
  deleteMsgs.run(session.id);

  // 重置会话，清除 sdk_session_id（使下次对话从新会话开始）
  const updateSession = db.prepare('UPDATE agent_sessions SET sdk_session_id = NULL, current_task = NULL, updated_at = ? WHERE id = ?');
  updateSession.run(new Date().toISOString(), session.id);

  return true;
}

// ============= Agent 长期记忆操作 =============

export function createAgentMemory(memory: DbAgentMemory): DbAgentMemory {
  const stmt = db.prepare(`
    INSERT INTO agent_memories (id, agent_id, category, content, importance, source_task, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(memory.id, memory.agent_id, memory.category, memory.content, memory.importance, memory.source_task, memory.created_at, memory.updated_at);
  return memory;
}

export function getAgentMemories(agentId: string, category?: string, limit = 50): DbAgentMemory[] {
  if (category) {
    const stmt = db.prepare('SELECT * FROM agent_memories WHERE agent_id = ? AND category = ? ORDER BY importance DESC, created_at DESC LIMIT ?');
    return stmt.all(agentId, category, limit) as DbAgentMemory[];
  }
  const stmt = db.prepare('SELECT * FROM agent_memories WHERE agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?');
  return stmt.all(agentId, limit) as DbAgentMemory[];
}

export function getAllAgentMemories(limit = 100): DbAgentMemory[] {
  const stmt = db.prepare('SELECT * FROM agent_memories ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as DbAgentMemory[];
}

export function deleteAgentMemory(id: string): boolean {
  const stmt = db.prepare('DELETE FROM agent_memories WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function clearAgentMemories(agentId: string): boolean {
  const stmt = db.prepare('DELETE FROM agent_memories WHERE agent_id = ?');
  stmt.run(agentId);
  return true;
}

// ============= 产出目录操作 =============

// 产出根目录
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

/**
 * 确保产出目录存在
 */
export function ensureOutputDir(): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  return OUTPUT_DIR;
}

/**
 * 保存策划案到产出目录
 */
export function saveProposalToFile(proposal: DbProposal): string | null {
  const dir = ensureOutputDir();
  const proposalsDir = path.join(dir, 'proposals');
  if (!fs.existsSync(proposalsDir)) fs.mkdirSync(proposalsDir, { recursive: true });

  const safeName = proposal.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
  const filePath = path.join(proposalsDir, `${proposal.type}_${proposal.id.slice(0, 8)}_${safeName}.md`);
  
  try {
    const content = `# ${proposal.title}\n\n` +
      `> 类型: ${proposal.type} | 作者: ${proposal.author_agent_id} | 版本: v${proposal.version}\n` +
      `> 创建时间: ${new Date(proposal.created_at).toLocaleString('zh-CN')}\n` +
      `> 状态: ${proposal.status}\n\n` +
      (proposal.review_comment ? `## CEO 评审意见\n\n${proposal.review_comment}\n\n` : '') +
      (proposal.user_comment ? `## 用户审批意见\n\n${proposal.user_comment}\n\n` : '') +
      `## 策划案内容\n\n${proposal.content}\n`;
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  } catch {
    return null;
  }
}

/**
 * 保存游戏到产出目录
 */
export function saveGameToFile(game: DbGame): string | null {
  const dir = ensureOutputDir();
  const gamesDir = path.join(dir, 'games');
  if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });

  const safeName = game.name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
  const filePath = path.join(gamesDir, `${game.name}_v${game.version}_${game.id.slice(0, 8)}.html`);
  
  try {
    fs.writeFileSync(filePath, game.html_content, 'utf-8');
    return filePath;
  } catch {
    return null;
  }
}

export default db;
