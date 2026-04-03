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
  -- 项目表
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Agent 会话表（每个Agent有自己的独立会话）
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
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
    project_id TEXT NOT NULL DEFAULT 'default',
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
    project_id TEXT NOT NULL DEFAULT 'default',
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
    project_id TEXT NOT NULL DEFAULT 'default',
    agent_id TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    level TEXT NOT NULL DEFAULT 'info',
    created_at TEXT NOT NULL
  );

  -- 指令表（用户向Agent下达的指令）
  CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
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
    project_id TEXT NOT NULL DEFAULT 'default',
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
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_agent ON agent_sessions(project_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_proposals_project_id ON proposals(project_id);
  CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_logs_project ON agent_logs(project_id);
  CREATE INDEX IF NOT EXISTS idx_games_project_id ON games(project_id);
  CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
  CREATE INDEX IF NOT EXISTS idx_commands_project ON commands(project_id);
  CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);
  CREATE INDEX IF NOT EXISTS idx_handoffs_to_agent ON handoffs(to_agent_id);
  CREATE INDEX IF NOT EXISTS idx_handoffs_project ON handoffs(project_id);

  -- Agent 长期记忆表（Agent 自主保存的重要信息）
  CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    agent_id TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    importance TEXT NOT NULL DEFAULT 'normal',
    source_task TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_memories_project_agent ON agent_memories(project_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_memories_category ON agent_memories(category);

  -- 任务看板表（开发/测试任务及状态）
  CREATE TABLE IF NOT EXISTS task_board_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL,
    description TEXT,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    source_task_id TEXT,
    created_by TEXT NOT NULL,
    updated_by TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_task_board_status ON task_board_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_task_board_type ON task_board_tasks(task_type);
  CREATE INDEX IF NOT EXISTS idx_task_board_project ON task_board_tasks(project_id);
`);

function hasColumn(tableName: 'proposals' | 'games' | 'agent_sessions' | 'agent_logs' | 'commands' | 'handoffs' | 'agent_memories', columnName: string): boolean {
  const pragmaSql = tableName === 'proposals'
    ? 'PRAGMA table_info(proposals)'
    : tableName === 'games'
      ? 'PRAGMA table_info(games)'
      : tableName === 'agent_sessions'
        ? 'PRAGMA table_info(agent_sessions)'
        : tableName === 'agent_logs'
          ? 'PRAGMA table_info(agent_logs)'
          : tableName === 'commands'
            ? 'PRAGMA table_info(commands)'
            : tableName === 'handoffs'
              ? 'PRAGMA table_info(handoffs)'
              : 'PRAGMA table_info(agent_memories)';
  const rows = db.prepare(pragmaSql).all() as Array<{ name: string }>;
  return rows.some(row => row.name === columnName);
}

function ensureProjectColumns(): void {
  if (!hasColumn('proposals', 'project_id')) {
    db.exec(`ALTER TABLE proposals ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
  }
  if (!hasColumn('games', 'project_id')) {
    db.exec(`ALTER TABLE games ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
  }
  db.exec(`UPDATE proposals SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
  db.exec(`UPDATE games SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
}

ensureProjectColumns();

function ensureProjectIsolationColumns(): void {
  if (!hasColumn('agent_sessions', 'project_id')) db.exec(`ALTER TABLE agent_sessions ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
  if (!hasColumn('agent_logs', 'project_id')) db.exec(`ALTER TABLE agent_logs ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
  if (!hasColumn('commands', 'project_id')) db.exec(`ALTER TABLE commands ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
  if (!hasColumn('handoffs', 'project_id')) db.exec(`ALTER TABLE handoffs ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
  if (!hasColumn('agent_memories', 'project_id')) db.exec(`ALTER TABLE agent_memories ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);

  db.exec(`UPDATE agent_sessions SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
  db.exec(`UPDATE agent_logs SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
  db.exec(`UPDATE commands SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
  db.exec(`UPDATE handoffs SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
  db.exec(`UPDATE agent_memories SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
}

ensureProjectIsolationColumns();
ensureProject('default');

// ============= 类型定义 =============

export interface DbAgentSession {
  id: string;
  project_id: string;
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
  project_id: string;
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
  project_id: string;
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
  project_id: string;
  agent_id: string;
  action: string;
  detail: string | null;
  level: 'info' | 'warn' | 'error' | 'success';
  created_at: string;
}

export interface DbCommand {
  id: string;
  project_id: string;
  target_agent_id: string;
  content: string;
  status: 'pending' | 'executing' | 'done' | 'failed';
  result: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface DbHandoff {
  id: string;
  project_id: string;
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
  project_id: string;
  agent_id: string;
  category: 'general' | 'preference' | 'decision' | 'lesson' | 'achievement';
  content: string;
  importance: 'low' | 'normal' | 'high' | 'critical';
  source_task: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbTaskBoardTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  task_type: 'development' | 'testing';
  status: 'todo' | 'developing' | 'testing' | 'blocked' | 'done';
  source_task_id: string | null;
  created_by: string;
  updated_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============= Agent 会话操作 =============

export function getAgentSession(projectId: string, agentId: string): DbAgentSession | undefined {
  const stmt = db.prepare('SELECT * FROM agent_sessions WHERE project_id = ? AND agent_id = ? ORDER BY updated_at DESC LIMIT 1');
  return stmt.get(projectId, agentId) as DbAgentSession | undefined;
}

export function getAllAgentSessions(): DbAgentSession[] {
  const stmt = db.prepare('SELECT * FROM agent_sessions ORDER BY updated_at DESC');
  return stmt.all() as DbAgentSession[];
}

export function upsertAgentSession(session: DbAgentSession): DbAgentSession {
  const existing = getAgentSession(session.project_id, session.agent_id);
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
      INSERT INTO agent_sessions (id, project_id, agent_id, sdk_session_id, status, current_task, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(session.id, session.project_id, session.agent_id, session.sdk_session_id, session.status, session.current_task, session.created_at, session.updated_at);
    return session;
  }
}

export function updateAgentStatus(projectId: string, agentId: string, status: DbAgentSession['status'], currentTask?: string | null): void {
  const existing = getAgentSession(projectId, agentId);
  if (existing) {
    const stmt = db.prepare('UPDATE agent_sessions SET status = ?, current_task = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, currentTask !== undefined ? currentTask : existing.current_task, new Date().toISOString(), existing.id);
  }
}

// ============= Agent 消息操作 =============

export function getAgentMessages(projectId: string, agentId: string, limit = 50): DbAgentMessage[] {
  const session = getAgentSession(projectId, agentId);
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
    INSERT INTO proposals (id, project_id, type, title, content, author_agent_id, status, reviewer_agent_id, review_comment, user_decision, user_comment, version, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    proposal.id,
    proposal.project_id,
    proposal.type,
    proposal.title,
    proposal.content,
    proposal.author_agent_id,
    proposal.status,
    proposal.reviewer_agent_id,
    proposal.review_comment,
    proposal.user_decision,
    proposal.user_comment,
    proposal.version,
    proposal.parent_id,
    proposal.created_at,
    proposal.updated_at
  );
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
    INSERT INTO games (id, project_id, name, description, html_content, proposal_id, version, status, author_agent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    game.id,
    game.project_id,
    game.name,
    game.description,
    game.html_content,
    game.proposal_id,
    game.version,
    game.status,
    game.author_agent_id,
    game.created_at,
    game.updated_at
  );
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
    INSERT INTO agent_logs (id, project_id, agent_id, action, detail, level, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(log.id, log.project_id, log.agent_id, log.action, log.detail, log.level, log.created_at);
}

export function getAgentLogs(projectId: string, agentId?: string, limit = 100): DbAgentLog[] {
  if (agentId) {
    const stmt = db.prepare('SELECT * FROM agent_logs WHERE project_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(projectId, agentId, limit) as DbAgentLog[];
  } else {
    const stmt = db.prepare('SELECT * FROM agent_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(projectId, limit) as DbAgentLog[];
  }
}

// ============= 指令操作 =============

export function createCommand(command: DbCommand): DbCommand {
  const stmt = db.prepare(`
    INSERT INTO commands (id, project_id, target_agent_id, content, status, result, created_at, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(command.id, command.project_id, command.target_agent_id, command.content, command.status, command.result, command.created_at, command.executed_at);
  return command;
}

export function getPendingCommands(projectId: string, agentId: string): DbCommand[] {
  const stmt = db.prepare("SELECT * FROM commands WHERE project_id = ? AND target_agent_id = ? AND status = 'pending' ORDER BY created_at ASC");
  return stmt.all(projectId, agentId) as DbCommand[];
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

export function getAllCommands(projectId: string, limit = 50): DbCommand[] {
  const stmt = db.prepare('SELECT * FROM commands WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(projectId, limit) as DbCommand[];
}

// ============= 任务交接操作 =============

export function createHandoff(handoff: DbHandoff): DbHandoff {
  const stmt = db.prepare(`
    INSERT INTO handoffs (id, project_id, from_agent_id, to_agent_id, title, description, context, status, priority, result, accepted_at, completed_at, source_command_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(handoff.id, handoff.project_id, handoff.from_agent_id, handoff.to_agent_id, handoff.title, handoff.description, handoff.context, handoff.status, handoff.priority, handoff.result, handoff.accepted_at, handoff.completed_at, handoff.source_command_id, handoff.created_at, handoff.updated_at);
  return handoff;
}

export function getHandoff(id: string): DbHandoff | undefined {
  const stmt = db.prepare('SELECT * FROM handoffs WHERE id = ?');
  return stmt.get(id) as DbHandoff | undefined;
}

export function getAllHandoffs(projectId: string, limit = 50): DbHandoff[] {
  const stmt = db.prepare('SELECT * FROM handoffs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(projectId, limit) as DbHandoff[];
}

export function getPendingHandoffs(projectId: string, toAgentId?: string): DbHandoff[] {
  if (toAgentId) {
    const stmt = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND to_agent_id = ? AND status IN ('pending', 'accepted', 'working') ORDER BY created_at DESC");
    return stmt.all(projectId, toAgentId) as DbHandoff[];
  }
  const stmt = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND status IN ('pending', 'accepted', 'working') ORDER BY created_at DESC");
  return stmt.all(projectId) as DbHandoff[];
}

export function getHandoffsForAgent(projectId: string, agentId: string, limit = 20): { incoming: DbHandoff[]; outgoing: DbHandoff[] } {
  const incoming = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND to_agent_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, agentId, limit) as DbHandoff[];
  const outgoing = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND from_agent_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, agentId, limit) as DbHandoff[];
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
export function clearAgentMessages(projectId: string, agentId: string): boolean {
  const session = getAgentSession(projectId, agentId);
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
    INSERT INTO agent_memories (id, project_id, agent_id, category, content, importance, source_task, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(memory.id, memory.project_id, memory.agent_id, memory.category, memory.content, memory.importance, memory.source_task, memory.created_at, memory.updated_at);
  return memory;
}

export function getAgentMemories(projectId: string, agentId: string, category?: string, limit = 50): DbAgentMemory[] {
  if (category) {
    const stmt = db.prepare('SELECT * FROM agent_memories WHERE project_id = ? AND agent_id = ? AND category = ? ORDER BY importance DESC, created_at DESC LIMIT ?');
    return stmt.all(projectId, agentId, category, limit) as DbAgentMemory[];
  }
  const stmt = db.prepare('SELECT * FROM agent_memories WHERE project_id = ? AND agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?');
  return stmt.all(projectId, agentId, limit) as DbAgentMemory[];
}

export function getAllAgentMemories(projectId: string, limit = 100): DbAgentMemory[] {
  const stmt = db.prepare('SELECT * FROM agent_memories WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(projectId, limit) as DbAgentMemory[];
}

export function deleteAgentMemory(id: string): boolean {
  const stmt = db.prepare('DELETE FROM agent_memories WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function clearAgentMemories(projectId: string, agentId: string): boolean {
  const stmt = db.prepare('DELETE FROM agent_memories WHERE project_id = ? AND agent_id = ?');
  stmt.run(projectId, agentId);
  return true;
}

// ============= 任务看板操作 =============

export function createTaskBoardTask(task: DbTaskBoardTask): DbTaskBoardTask {
  const stmt = db.prepare(`
    INSERT INTO task_board_tasks (
      id, project_id, title, description, task_type, status, source_task_id,
      created_by, updated_by, started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    task.id,
    task.project_id,
    task.title,
    task.description,
    task.task_type,
    task.status,
    task.source_task_id,
    task.created_by,
    task.updated_by,
    task.started_at,
    task.completed_at,
    task.created_at,
    task.updated_at
  );
  return task;
}

export function getTaskBoardTask(id: string): DbTaskBoardTask | undefined {
  const stmt = db.prepare('SELECT * FROM task_board_tasks WHERE id = ?');
  return stmt.get(id) as DbTaskBoardTask | undefined;
}

export function getTaskBoardTasks(projectId?: string): DbTaskBoardTask[] {
  if (projectId) {
    const stmt = db.prepare('SELECT * FROM task_board_tasks WHERE project_id = ? ORDER BY created_at DESC');
    return stmt.all(projectId) as DbTaskBoardTask[];
  }
  const stmt = db.prepare('SELECT * FROM task_board_tasks ORDER BY created_at DESC');
  return stmt.all() as DbTaskBoardTask[];
}

export function getAllProjectIds(): string[] {
  const rows = db.prepare(`
    SELECT id AS project_id FROM projects
    UNION
    SELECT project_id FROM proposals WHERE project_id IS NOT NULL
    UNION
    SELECT project_id FROM games WHERE project_id IS NOT NULL
    UNION
    SELECT project_id FROM task_board_tasks WHERE project_id IS NOT NULL
    ORDER BY project_id ASC
  `).all() as { project_id: string }[];

  const ids = rows
    .map(r => r.project_id)
    .filter(id => id !== '');
  if (!ids.includes('default')) ids.unshift('default');
  return ids;
}

export function createProject(project: { id: string; name: string; created_at: string; updated_at: string }): { id: string; name: string; created_at: string; updated_at: string } {
  const stmt = db.prepare(`
    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(project.id, project.name, project.created_at, project.updated_at);
  return project;
}

export function getProject(projectId: string): { id: string; name: string; created_at: string; updated_at: string } | undefined {
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  return stmt.get(projectId) as { id: string; name: string; created_at: string; updated_at: string } | undefined;
}

export function ensureProject(projectId: string): void {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) return;
  if (getProject(safeProjectId)) return;
  const now = new Date().toISOString();
  createProject({ id: safeProjectId, name: safeProjectId, created_at: now, updated_at: now });
}

export function updateTaskBoardTask(id: string, updates: Partial<DbTaskBoardTask>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbTaskBoardTask)[] = ['title', 'description', 'status', 'updated_by', 'started_at', 'completed_at'];
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
  const stmt = db.prepare(`UPDATE task_board_tasks SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// ============= 产出目录操作 =============

// 产出根目录
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_PROJECT_ID_LENGTH = 64;
const MAX_FILENAME_LENGTH = 50;
const MAX_VERSION_LENGTH = 30;

function sanitizeFilename(value: string, maxLength: number): string {
  return value
    .replace(/\0/g, '')
    .replace(/[\x00-\x1f\x80-\x9f]/g, '_')
    .replace(/[<>:"/\\|?*]/g, '_')
    .slice(0, maxLength);
}

function normalizeProjectId(projectId: string | null | undefined): string {
  const raw = (projectId || 'default').trim();
  if (!raw) return 'default';
  if (raw.length > MAX_PROJECT_ID_LENGTH) return 'default';
  if (!PROJECT_ID_PATTERN.test(raw)) return 'default';
  return raw;
}

function resolveSafePath(baseDir: string, fileName: string): string {
  const resolvedBase = path.resolve(baseDir);
  const candidate = path.resolve(baseDir, fileName);
  if (!candidate.startsWith(`${resolvedBase}${path.sep}`) && candidate !== resolvedBase) {
    throw new Error('非法文件路径');
  }
  return candidate;
}

/**
 * 确保产出目录存在
 */
export function ensureOutputDir(): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  return OUTPUT_DIR;
}

function ensureProjectOutputDirs(projectId: string): { projectDir: string; proposalsDir: string; gamesDir: string } {
  const root = ensureOutputDir();
  const safeProjectId = normalizeProjectId(projectId);
  const projectDir = path.join(root, safeProjectId);
  // 统一采用 output/{projectId}/proposals 与 output/{projectId}/games 两类产出目录，避免混放。
  const proposalsDir = path.join(projectDir, 'proposals');
  const gamesDir = path.join(projectDir, 'games');
  [projectDir, proposalsDir, gamesDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  return { projectDir, proposalsDir, gamesDir };
}

/**
 * 保存策划案到产出目录
 */
export function saveProposalToFile(proposal: DbProposal): string | null {
  const { proposalsDir } = ensureProjectOutputDirs(proposal.project_id);
  const safeType = sanitizeFilename(proposal.type, 20) || 'proposal';

  const filePath = resolveSafePath(proposalsDir, `${safeType}_${proposal.id.slice(0, 8)}.md`);
  
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
  const { gamesDir } = ensureProjectOutputDirs(game.project_id);

  const safeName = sanitizeFilename(game.name, MAX_FILENAME_LENGTH);
  const safeVersion = sanitizeFilename(game.version, MAX_VERSION_LENGTH);
  const filePath = resolveSafePath(gamesDir, `${safeName}_v${safeVersion}_${game.id.slice(0, 8)}.html`);
  
  try {
    fs.writeFileSync(filePath, game.html_content, 'utf-8');
    return filePath;
  } catch {
    return null;
  }
}
