import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const MAX_PROJECT_ID_LENGTH = 64;
export const MAX_FILENAME_LENGTH = 50;
export const MAX_VERSION_LENGTH = 30;
export const MIN_GAME_HTML_LENGTH = 100;
export const SINGLE_LINE_TITLE_PATTERN = /^[^\r\n]*$/;
export const PROPOSAL_TYPES = ['game_design', 'biz_design', 'tech_arch', 'tech_impl', 'ceo_review'] as const;
export const PROPOSAL_STATUSES = ['pending_review', 'under_review', 'approved', 'rejected', 'revision_needed', 'user_approved', 'user_rejected'] as const;
export const GAME_STATUSES = ['draft', 'published'] as const;
export const HANDOFF_STATUSES = ['pending', 'accepted', 'working', 'completed', 'rejected', 'cancelled'] as const;
export const HANDOFF_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TASK_TYPES = ['development', 'testing'] as const;
export const TASK_STATUSES = ['todo', 'developing', 'testing', 'blocked', 'done'] as const;

export function normalizeAndValidateRequiredText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是字符串`);
  }
  const text = value.trim();
  if (!text) {
    throw new Error(`${fieldName} 不能为空`);
  }
  return text;
}

export function normalizeOptionalText(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是字符串`);
  }
  const text = value.trim();
  return text || null;
}

function validateEnumValue<T extends readonly string[]>(value: unknown, fieldName: string, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value as T[number])) {
    throw new Error(`${fieldName} 不合法，可选值：${allowed.join(' / ')}`);
  }
  return value as T[number];
}

export function normalizeAndValidateTitle(value: unknown, fieldName = 'title'): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是字符串`);
  }
  const title = value.trim();
  if (!title) {
    throw new Error(`${fieldName} 不能为空`);
  }
  if (!SINGLE_LINE_TITLE_PATTERN.test(title)) {
    throw new Error(`${fieldName} 不允许包含换行符`);
  }
  return title;
}
const dbPath = path.join(__dirname, '..', 'data', 'studio.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  -- 项目表
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 项目配置表
  CREATE TABLE IF NOT EXISTS project_settings (
    project_id TEXT PRIMARY KEY,
    autopilot_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
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
    file_storage_id TEXT,
    proposal_id TEXT,
    version TEXT NOT NULL DEFAULT '1.0.0',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 统一日志表（系统日志 + 流式日志）
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    agent_id TEXT NOT NULL,
    log_type TEXT NOT NULL DEFAULT 'system',
    level TEXT NOT NULL DEFAULT 'info',
    content TEXT NOT NULL DEFAULT '',
    tool_name TEXT,
    action TEXT,
    is_error INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_project ON logs(project_id);
  CREATE INDEX IF NOT EXISTS idx_logs_project_agent ON logs(project_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(log_type);

  -- 指令表（用户向Agent下达的指令）
  CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    target_agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at TEXT NOT NULL,
    executed_at TEXT,
    updated_at TEXT NOT NULL
  );

  -- 权限请求表（工具执行审批消息）
  CREATE TABLE IF NOT EXISTS permission_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    agent_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input TEXT NOT NULL, -- JSON 序列化后的输入参数
    status TEXT NOT NULL DEFAULT 'pending', -- pending, allowed, denied, expired
    behavior TEXT, -- allow, deny
    message TEXT, -- 用户回复的消息
    updated_input TEXT, -- 用户修改后的输入参数（JSON）
    created_at TEXT NOT NULL,
    responded_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_permission_requests_project ON permission_requests(project_id);
  CREATE INDEX IF NOT EXISTS idx_permission_requests_status ON permission_requests(status);
  CREATE INDEX IF NOT EXISTS idx_permission_requests_project_status ON permission_requests(project_id, status);

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

  CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_agent ON agent_sessions(project_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_proposals_project_id ON proposals(project_id);
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
  CREATE INDEX IF NOT EXISTS idx_agent_memories_project_agent_created_at ON agent_memories(project_id, agent_id, created_at DESC);

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

  -- 文件存储表（MinIO 对象元数据）
  CREATE TABLE IF NOT EXISTS file_storages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    file_name TEXT,
    file_size INTEGER,
    content_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, object_key)
  );

  CREATE INDEX IF NOT EXISTS idx_file_storages_project ON file_storages(project_id);

  -- Blender 建模项目表（关联 studio project 与 creator service project）
  CREATE TABLE IF NOT EXISTS blender_projects (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    blender_project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_blender_projects_project ON blender_projects(project_id);
`);
ensureProject('default');
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
  file_storage_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbFileStorage {
  id: string;
  project_id: string;
  object_key: string;
  file_name: string | null;
  file_size: number | null;
  content_type: string | null;
  created_at: string;
  updated_at: string;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type LogType = 'system' | 'text' | 'tool' | 'tool_result' | 'done' | 'error' | 'user_command';

export interface DbLog {
  id: string;
  project_id: string;
  agent_id: string;
  log_type: LogType;
  level: LogLevel;
  content: string;
  tool_name: string | null;
  action: string | null;
  is_error: boolean;
  created_at: string;
  updated_at: string;
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
  updated_at: string;
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

export interface DbBlenderProject {
  id: string;
  project_id: string;
  blender_project_id: string;
  name: string;
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

const CEO_AGENT_ID = 'ceo' as const;

export interface DbProjectSettings {
  project_id: string;
  autopilot_enabled: number;
  created_at: string;
  updated_at: string;
}
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
export function getAllProposals(): DbProposal[] {
  const stmt = db.prepare('SELECT * FROM proposals ORDER BY created_at DESC');
  return stmt.all() as DbProposal[];
}

export function getScopedProposals(
  projectId: string,
  options?: { status?: DbProposal['status']; limit?: number; agentId?: string; includeAllForCeo?: boolean }
): DbProposal[] {
  const conditions: string[] = ['project_id = ?'];
  const params: any[] = [projectId];
  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }
  if (options?.agentId && !(options.includeAllForCeo && options.agentId === CEO_AGENT_ID)) {
    conditions.push('(author_agent_id = ? OR reviewer_agent_id = ?)');
    params.push(options.agentId, options.agentId);
  }
  let sql = `SELECT * FROM proposals WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
  if (options?.limit && options.limit > 0) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  const stmt = db.prepare(sql);
  return stmt.all(...params) as DbProposal[];
}

export function getProposal(id: string): DbProposal | undefined {
  const stmt = db.prepare('SELECT * FROM proposals WHERE id = ?');
  return stmt.get(id) as DbProposal | undefined;
}

export function createProposal(proposal: DbProposal): DbProposal {
  const normalizedTitle = normalizeAndValidateTitle(proposal.title, 'title');
  const normalizedProjectId = normalizeAndValidateRequiredText(proposal.project_id, 'project_id');
  const normalizedType = validateEnumValue(proposal.type, 'type', PROPOSAL_TYPES);
  const normalizedContent = normalizeAndValidateRequiredText(proposal.content, 'content');
  const normalizedAuthorAgentId = normalizeAndValidateRequiredText(proposal.author_agent_id, 'author_agent_id');
  const normalizedStatus = validateEnumValue(proposal.status, 'status', PROPOSAL_STATUSES);
  const stmt = db.prepare(`
    INSERT INTO proposals (id, project_id, type, title, content, author_agent_id, status, reviewer_agent_id, review_comment, user_decision, user_comment, version, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    proposal.id,
    normalizedProjectId,
    normalizedType,
    normalizedTitle,
    normalizedContent,
    normalizedAuthorAgentId,
    normalizedStatus,
    proposal.reviewer_agent_id,
    proposal.review_comment,
    proposal.user_decision,
    proposal.user_comment,
    proposal.version,
    proposal.parent_id,
    proposal.created_at,
    proposal.updated_at
  );
  return {
    ...proposal,
    project_id: normalizedProjectId,
    type: normalizedType,
    title: normalizedTitle,
    content: normalizedContent,
    author_agent_id: normalizedAuthorAgentId,
    status: normalizedStatus
  };
}

export function updateProposal(id: string, updates: Partial<DbProposal>): boolean {
  const normalizedUpdates: Partial<DbProposal> = { ...updates };
  if (normalizedUpdates.title !== undefined) {
    normalizedUpdates.title = normalizeAndValidateTitle(normalizedUpdates.title, 'title');
  }
  if (normalizedUpdates.content !== undefined) {
    normalizedUpdates.content = normalizeAndValidateRequiredText(normalizedUpdates.content, 'content');
  }
  if (normalizedUpdates.status !== undefined) {
    normalizedUpdates.status = validateEnumValue(normalizedUpdates.status, 'status', PROPOSAL_STATUSES);
  }
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbProposal)[] = ['status', 'reviewer_agent_id', 'review_comment', 'user_decision', 'user_comment', 'content', 'title'];
  for (const key of allowed) {
    if (normalizedUpdates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(normalizedUpdates[key]);
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
export function getAllGames(): DbGame[] {
  const stmt = db.prepare('SELECT * FROM games ORDER BY created_at DESC');
  return stmt.all() as DbGame[];
}

export function getGame(id: string): DbGame | undefined {
  const stmt = db.prepare('SELECT * FROM games WHERE id = ?');
  return stmt.get(id) as DbGame | undefined;
}

export function createGame(game: DbGame): DbGame {
  const normalizedProjectId = normalizeAndValidateRequiredText(game.project_id, 'project_id');
  const normalizedName = normalizeAndValidateRequiredText(game.name, 'name');
  if (normalizedName.length > MAX_FILENAME_LENGTH) {
    throw new Error(`name 长度不能超过 ${MAX_FILENAME_LENGTH}`);
  }
  const normalizedHtmlContent = normalizeAndValidateRequiredText(game.html_content, 'html_content');
  if (normalizedHtmlContent.length < MIN_GAME_HTML_LENGTH) {
    throw new Error(`html_content 长度不能少于 ${MIN_GAME_HTML_LENGTH}`);
  }
  const normalizedVersion = normalizeAndValidateRequiredText(game.version, 'version');
  if (normalizedVersion.length > MAX_VERSION_LENGTH) {
    throw new Error(`version 长度不能超过 ${MAX_VERSION_LENGTH}`);
  }
  const normalizedStatus = validateEnumValue(game.status, 'status', GAME_STATUSES);
  const normalizedDescription = normalizeOptionalText(game.description, 'description');
  const normalizedProposalId = normalizeOptionalText(game.proposal_id, 'proposal_id');
  const normalizedFileStorageId = normalizeOptionalText(game.file_storage_id, 'file_storage_id');
  const stmt = db.prepare(`
    INSERT INTO games (id, project_id, name, description, html_content, proposal_id, version, status, file_storage_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    game.id,
    normalizedProjectId,
    normalizedName,
    normalizedDescription,
    normalizedHtmlContent,
    normalizedProposalId,
    normalizedVersion,
    normalizedStatus,
    normalizedFileStorageId,
    game.created_at,
    game.updated_at
  );
  return {
    ...game,
    project_id: normalizedProjectId,
    name: normalizedName,
    description: normalizedDescription,
    html_content: normalizedHtmlContent,
    proposal_id: normalizedProposalId,
    version: normalizedVersion,
    status: normalizedStatus,
    file_storage_id: normalizedFileStorageId
  };
}

export function updateGame(id: string, updates: Partial<DbGame>): boolean {
  const normalizedUpdates: Partial<DbGame> = { ...updates };
  if (normalizedUpdates.name !== undefined) {
    const normalizedName = normalizeAndValidateRequiredText(normalizedUpdates.name, 'name');
    if (normalizedName.length > MAX_FILENAME_LENGTH) {
      throw new Error(`name 长度不能超过 ${MAX_FILENAME_LENGTH}`);
    }
    normalizedUpdates.name = normalizedName;
  }
  if (normalizedUpdates.description !== undefined) {
    normalizedUpdates.description = normalizeOptionalText(normalizedUpdates.description, 'description');
  }
  if (normalizedUpdates.html_content !== undefined) {
    const normalizedHtmlContent = normalizeAndValidateRequiredText(normalizedUpdates.html_content, 'html_content');
    if (normalizedHtmlContent.length < MIN_GAME_HTML_LENGTH) {
      throw new Error(`html_content 长度不能少于 ${MIN_GAME_HTML_LENGTH}`);
    }
    normalizedUpdates.html_content = normalizedHtmlContent;
  }
  if (normalizedUpdates.version !== undefined) {
    const normalizedVersion = normalizeAndValidateRequiredText(normalizedUpdates.version, 'version');
    if (normalizedVersion.length > MAX_VERSION_LENGTH) {
      throw new Error(`version 长度不能超过 ${MAX_VERSION_LENGTH}`);
    }
    normalizedUpdates.version = normalizedVersion;
  }
  if (normalizedUpdates.status !== undefined) {
    normalizedUpdates.status = validateEnumValue(normalizedUpdates.status, 'status', GAME_STATUSES);
  }
  if (normalizedUpdates.file_storage_id !== undefined) {
    normalizedUpdates.file_storage_id = normalizeOptionalText(normalizedUpdates.file_storage_id, 'file_storage_id');
  }
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbGame)[] = ['name', 'description', 'html_content', 'status', 'version', 'file_storage_id'];
  for (const key of allowed) {
    if (normalizedUpdates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(normalizedUpdates[key]);
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
export function addLog(log: DbLog): void {
  const stmt = db.prepare(`
    INSERT INTO logs (id, project_id, agent_id, log_type, level, content, tool_name, action, is_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(log.id, log.project_id, log.agent_id, log.log_type, log.level, log.content, log.tool_name || null, log.action || null, log.is_error ? 1 : 0, log.created_at, log.updated_at);
}

export function getLogs(projectId: string, agentId?: string, limit = 1000): DbLog[] {
  if (agentId) {
    const stmt = db.prepare('SELECT * FROM logs WHERE project_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?');
    return (stmt.all(projectId, agentId, limit) as DbLog[]).reverse();
  } else {
    const stmt = db.prepare('SELECT * FROM logs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
    return (stmt.all(projectId, limit) as DbLog[]).reverse();
  }
}

export function deleteLogs(projectId: string, agentId?: string): void {
  if (agentId) {
    const stmt = db.prepare('DELETE FROM logs WHERE project_id = ? AND agent_id = ?');
    stmt.run(projectId, agentId);
    return;
  }
  const stmt = db.prepare('DELETE FROM logs WHERE project_id = ?');
  stmt.run(projectId);
}
export function createCommand(command: DbCommand): DbCommand {
  const stmt = db.prepare(`
    INSERT INTO commands (id, project_id, target_agent_id, content, status, result, created_at, executed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(command.id, command.project_id, command.target_agent_id, command.content, command.status, command.result, command.created_at, command.executed_at, command.updated_at);
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
  if (updates.updated_at !== undefined) { fields.push('updated_at = ?'); values.push(updates.updated_at); }
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
export interface DbPermissionRequest {
  id: string;
  project_id: string;
  agent_id: string;
  tool_name: string;
  input: string; // JSON string
  status: 'pending' | 'allowed' | 'denied' | 'expired';
  behavior?: 'allow' | 'deny';
  message?: string;
  updated_input?: string; // JSON string
  created_at: string;
  responded_at?: string;
  updated_at: string;
}

export function createPermissionRequest(request: DbPermissionRequest): DbPermissionRequest {
  const stmt = db.prepare(`
    INSERT INTO permission_requests (id, project_id, agent_id, tool_name, input, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(request.id, request.project_id, request.agent_id, request.tool_name, request.input, request.status, request.created_at, request.updated_at);
  return request;
}

export function getPendingPermissionRequests(projectId: string): DbPermissionRequest[] {
  const stmt = db.prepare("SELECT * FROM permission_requests WHERE project_id = ? AND status = 'pending' ORDER BY created_at ASC");
  return stmt.all(projectId) as DbPermissionRequest[];
}

export function respondToPermissionRequest(
  id: string,
  behavior: 'allow' | 'deny',
  message?: string,
  updatedInput?: Record<string, unknown>
): boolean {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE permission_requests
    SET status = ?, behavior = ?, message = ?, updated_input = ?, responded_at = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `);
  const result = stmt.run(
    behavior === 'allow' ? 'allowed' : 'denied',
    behavior,
    message || null,
    updatedInput ? JSON.stringify(updatedInput) : null,
    now,
    now,
    id
  );
  return result.changes > 0;
}

export function expirePermissionRequest(id: string): boolean {
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE permission_requests SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'");
  const result = stmt.run(now, id);
  return result.changes > 0;
}

export function getPermissionRequest(id: string): DbPermissionRequest | null {
  const stmt = db.prepare('SELECT * FROM permission_requests WHERE id = ?');
  const result = stmt.get(id) as DbPermissionRequest | undefined;
  return result || null;
}
export function createHandoff(handoff: DbHandoff): DbHandoff {
  const normalizedTitle = normalizeAndValidateTitle(handoff.title, 'title');
  const normalizedProjectId = normalizeAndValidateRequiredText(handoff.project_id, 'project_id');
  const normalizedFromAgentId = normalizeAndValidateRequiredText(handoff.from_agent_id, 'from_agent_id');
  const normalizedToAgentId = normalizeAndValidateRequiredText(handoff.to_agent_id, 'to_agent_id');
  const normalizedDescription = normalizeAndValidateRequiredText(handoff.description, 'description');
  const normalizedStatus = validateEnumValue(handoff.status, 'status', HANDOFF_STATUSES);
  const normalizedPriority = validateEnumValue(handoff.priority, 'priority', HANDOFF_PRIORITIES);
  const normalizedContext = normalizeOptionalText(handoff.context, 'context');
  const normalizedResult = normalizeOptionalText(handoff.result, 'result');
  const normalizedSourceCommandId = normalizeOptionalText(handoff.source_command_id, 'source_command_id');
  const stmt = db.prepare(`
    INSERT INTO handoffs (id, project_id, from_agent_id, to_agent_id, title, description, context, status, priority, result, accepted_at, completed_at, source_command_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    handoff.id,
    normalizedProjectId,
    normalizedFromAgentId,
    normalizedToAgentId,
    normalizedTitle,
    normalizedDescription,
    normalizedContext,
    normalizedStatus,
    normalizedPriority,
    normalizedResult,
    handoff.accepted_at,
    handoff.completed_at,
    normalizedSourceCommandId,
    handoff.created_at,
    handoff.updated_at
  );
  return {
    ...handoff,
    project_id: normalizedProjectId,
    from_agent_id: normalizedFromAgentId,
    to_agent_id: normalizedToAgentId,
    title: normalizedTitle,
    description: normalizedDescription,
    context: normalizedContext,
    status: normalizedStatus,
    priority: normalizedPriority,
    result: normalizedResult,
    source_command_id: normalizedSourceCommandId
  };
}

export function getHandoff(id: string): DbHandoff | undefined {
  const stmt = db.prepare('SELECT * FROM handoffs WHERE id = ?');
  return stmt.get(id) as DbHandoff | undefined;
}

export function getAllHandoffs(projectId: string, limit = 50): DbHandoff[] {
  const stmt = db.prepare('SELECT * FROM handoffs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(projectId, limit) as DbHandoff[];
}

export function getPendingHandoffs(projectId: string, toAgentId?: string, limit?: number): DbHandoff[] {
  const params: any[] = [projectId];
  let sql = 'SELECT * FROM handoffs WHERE project_id = ?';
  if (toAgentId) {
    sql += ' AND to_agent_id = ?';
    params.push(toAgentId);
  }
  sql += ' AND status IN (\'pending\', \'accepted\', \'working\') ORDER BY created_at DESC';
  if (limit && limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  const stmt = db.prepare(sql);
  return stmt.all(...params) as DbHandoff[];
}

export function getHandoffsForAgent(projectId: string, agentId: string, limit = 20): { incoming: DbHandoff[]; outgoing: DbHandoff[] } {
  const incoming = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND to_agent_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, agentId, limit) as DbHandoff[];
  const outgoing = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND from_agent_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, agentId, limit) as DbHandoff[];
  return { incoming, outgoing };
}

export function updateHandoff(id: string, updates: Partial<DbHandoff>): boolean {
  const normalizedUpdates: Partial<DbHandoff> = { ...updates };
  if (normalizedUpdates.status !== undefined) {
    normalizedUpdates.status = validateEnumValue(normalizedUpdates.status, 'status', HANDOFF_STATUSES);
  }
  if (normalizedUpdates.priority !== undefined) {
    normalizedUpdates.priority = validateEnumValue(normalizedUpdates.priority, 'priority', HANDOFF_PRIORITIES);
  }
  if (normalizedUpdates.description !== undefined) {
    normalizedUpdates.description = normalizeAndValidateRequiredText(normalizedUpdates.description, 'description');
  }
  if (normalizedUpdates.context !== undefined) {
    normalizedUpdates.context = normalizeOptionalText(normalizedUpdates.context, 'context');
  }
  if (normalizedUpdates.result !== undefined) {
    normalizedUpdates.result = normalizeOptionalText(normalizedUpdates.result, 'result');
  }
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbHandoff)[] = ['status', 'result', 'accepted_at', 'completed_at', 'description', 'context', 'priority'];
  for (const key of allowed) {
    if (normalizedUpdates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(normalizedUpdates[key]);
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
export function createAgentMemory(memory: DbAgentMemory): DbAgentMemory {
  const stmt = db.prepare(`
    INSERT INTO agent_memories (id, project_id, agent_id, category, content, importance, source_task, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(memory.id, memory.project_id, memory.agent_id, memory.category, memory.content, memory.importance, memory.source_task, memory.created_at, memory.updated_at);
  return memory;
}

export function getAgentMemories(
  projectId: string,
  agentId: string,
  categoryOrOptions?: string | { category?: string; keyword?: string; limit?: number },
  limit = 50
): DbAgentMemory[] {
  const escapeLikeWildcards = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const options = typeof categoryOrOptions === 'string'
    ? { category: categoryOrOptions, limit }
    : (categoryOrOptions || { limit });
  const conditions: string[] = ['project_id = ?', 'agent_id = ?'];
  const params: any[] = [projectId, agentId];
  if (options.category) {
    conditions.push('category = ?');
    params.push(options.category);
  }
  const keyword = options.keyword?.trim();
  if (keyword) {
    conditions.push("content LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLikeWildcards(keyword)}%`);
  }
  const effectiveLimit = options.limit && options.limit > 0 ? options.limit : limit;
  const importanceOrderExpr = "CASE importance WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END";
  const sql = `SELECT * FROM agent_memories WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, ${importanceOrderExpr} DESC LIMIT ?`;
  params.push(effectiveLimit);
  const stmt = db.prepare(sql);
  return stmt.all(...params) as DbAgentMemory[];
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
export function createTaskBoardTask(task: DbTaskBoardTask): DbTaskBoardTask {
  const normalizedTitle = normalizeAndValidateTitle(task.title, 'title');
  const normalizedProjectId = normalizeAndValidateRequiredText(task.project_id, 'project_id');
  const normalizedTaskType = validateEnumValue(task.task_type, 'task_type', TASK_TYPES);
  const normalizedStatus = validateEnumValue(task.status, 'status', TASK_STATUSES);
  const normalizedCreatedBy = normalizeAndValidateRequiredText(task.created_by, 'created_by');
  const normalizedUpdatedBy = normalizeOptionalText(task.updated_by, 'updated_by');
  const normalizedDescription = normalizeOptionalText(task.description, 'description');
  const normalizedSourceTaskId = normalizeOptionalText(task.source_task_id, 'source_task_id');
  const stmt = db.prepare(`
    INSERT INTO task_board_tasks (
      id, project_id, title, description, task_type, status, source_task_id,
      created_by, updated_by, started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    task.id,
    normalizedProjectId,
    normalizedTitle,
    normalizedDescription,
    normalizedTaskType,
    normalizedStatus,
    normalizedSourceTaskId,
    normalizedCreatedBy,
    normalizedUpdatedBy,
    task.started_at,
    task.completed_at,
    task.created_at,
    task.updated_at
  );
  return {
    ...task,
    project_id: normalizedProjectId,
    title: normalizedTitle,
    description: normalizedDescription,
    task_type: normalizedTaskType,
    status: normalizedStatus,
    source_task_id: normalizedSourceTaskId,
    created_by: normalizedCreatedBy,
    updated_by: normalizedUpdatedBy
  };
}

export function getTaskBoardTask(id: string): DbTaskBoardTask | undefined {
  const stmt = db.prepare('SELECT * FROM task_board_tasks WHERE id = ?');
  return stmt.get(id) as DbTaskBoardTask | undefined;
}

export function getTaskBoardTasks(
  projectIdOrOptions?: string | { projectId?: string; status?: DbTaskBoardTask['status']; taskType?: DbTaskBoardTask['task_type']; agentId?: string; limit?: number }
): DbTaskBoardTask[] {
  const options = typeof projectIdOrOptions === 'string'
    ? { projectId: projectIdOrOptions }
    : (projectIdOrOptions || {});
  const conditions: string[] = [];
  const params: any[] = [];
  if (options.projectId) {
    conditions.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }
  if (options.taskType) {
    conditions.push('task_type = ?');
    params.push(options.taskType);
  }
  if (options.agentId) {
    conditions.push('(created_by = ? OR updated_by = ?)');
    params.push(options.agentId, options.agentId);
  }
  let sql = 'SELECT * FROM task_board_tasks';
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY created_at DESC';
  if (options.limit && options.limit > 0) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  const stmt = db.prepare(sql);
  return stmt.all(...params) as DbTaskBoardTask[];
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

function createDefaultProjectSettings(projectId: string): DbProjectSettings {
  const now = new Date().toISOString();
  const settings: DbProjectSettings = {
    project_id: projectId,
    autopilot_enabled: 0,
    created_at: now,
    updated_at: now
  };
  const stmt = db.prepare(`
    INSERT INTO project_settings (project_id, autopilot_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(settings.project_id, settings.autopilot_enabled, settings.created_at, settings.updated_at);
  return settings;
}

export function getProjectSettings(projectId: string): DbProjectSettings {
  const safeProjectId = normalizeProjectId(projectId);
  const stmt = db.prepare('SELECT * FROM project_settings WHERE project_id = ?');
  const found = stmt.get(safeProjectId) as DbProjectSettings | undefined;
  if (found) return found;
  return createDefaultProjectSettings(safeProjectId);
}

export function updateProjectSettings(
  projectId: string,
  updates: Partial<Pick<DbProjectSettings, 'autopilot_enabled'>>
): DbProjectSettings {
  const safeProjectId = normalizeProjectId(projectId);
  getProjectSettings(safeProjectId);
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.autopilot_enabled !== undefined) {
    fields.push('autopilot_enabled = ?');
    values.push(updates.autopilot_enabled);
  }
  if (fields.length === 0) {
    return getProjectSettings(safeProjectId);
  }
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(safeProjectId);
  const stmt = db.prepare(`UPDATE project_settings SET ${fields.join(', ')} WHERE project_id = ?`);
  stmt.run(...values);
  return getProjectSettings(safeProjectId);
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
  if (!getProject(safeProjectId)) {
    const now = new Date().toISOString();
    createProject({ id: safeProjectId, name: safeProjectId, created_at: now, updated_at: now });
  }
  getProjectSettings(safeProjectId);
}

export function updateTaskBoardTask(id: string, updates: Partial<DbTaskBoardTask>): boolean {
  const normalizedUpdates: Partial<DbTaskBoardTask> = { ...updates };
  if (normalizedUpdates.title !== undefined) {
    normalizedUpdates.title = normalizeAndValidateTitle(normalizedUpdates.title, 'title');
  }
  if (normalizedUpdates.description !== undefined) {
    normalizedUpdates.description = normalizeOptionalText(normalizedUpdates.description, 'description');
  }
  if (normalizedUpdates.status !== undefined) {
    normalizedUpdates.status = validateEnumValue(normalizedUpdates.status, 'status', TASK_STATUSES);
  }
  if (normalizedUpdates.updated_by !== undefined) {
    normalizedUpdates.updated_by = normalizeOptionalText(normalizedUpdates.updated_by, 'updated_by');
  }
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbTaskBoardTask)[] = ['title', 'description', 'status', 'updated_by', 'started_at', 'completed_at'];
  for (const key of allowed) {
    if (normalizedUpdates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(normalizedUpdates[key]);
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
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

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

export function resolveSafePath(baseDir: string, fileName: string): string {
  const resolvedBase = path.resolve(baseDir);
  const candidate = path.resolve(baseDir, fileName);
  if (!candidate.startsWith(`${resolvedBase}${path.sep}`) && candidate !== resolvedBase) {
    throw new Error('非法文件路径');
  }
  return candidate;
}

/**
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
  const proposalsDir = path.join(projectDir, 'proposals');
  const gamesDir = path.join(projectDir, 'games');
  [projectDir, proposalsDir, gamesDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  return { projectDir, proposalsDir, gamesDir };
}

/**
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

// ============================================================================
// FileStorage CRUD（MinIO 对象元数据）
// ============================================================================

const OBJECT_KEY_PATTERN = /^[a-zA-Z0-9_\-./]+$/;
const MAX_OBJECT_KEY_LENGTH = 512;

function validateObjectKey(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是字符串`);
  const text = value.trim();
  if (!text) throw new Error(`${fieldName} 不能为空`);
  if (text.length > MAX_OBJECT_KEY_LENGTH) throw new Error(`${fieldName} 长度不能超过 ${MAX_OBJECT_KEY_LENGTH}`);
  if (!OBJECT_KEY_PATTERN.test(text)) throw new Error(`${fieldName} 包含非法字符`);
  if (text.includes('..')) throw new Error(`${fieldName} 不允许包含 .. 路径穿越`);
  return text;
}

export function createFileStorage(storage: DbFileStorage): DbFileStorage {
  const normalizedProjectId = normalizeAndValidateRequiredText(storage.project_id, 'project_id');
  const normalizedObjectKey = validateObjectKey(storage.object_key, 'object_key');
  const normalizedFileName = normalizeOptionalText(storage.file_name, 'file_name');
  const normalizedContentType = normalizeOptionalText(storage.content_type, 'content_type');
  const stmt = db.prepare(`
    INSERT INTO file_storages (id, project_id, object_key, file_name, file_size, content_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    storage.id,
    normalizedProjectId,
    normalizedObjectKey,
    normalizedFileName,
    storage.file_size ?? null,
    normalizedContentType,
    storage.created_at,
    storage.updated_at
  );
  return {
    ...storage,
    project_id: normalizedProjectId,
    object_key: normalizedObjectKey,
    file_name: normalizedFileName,
    content_type: normalizedContentType
  };
}

export function getFileStorage(id: string): DbFileStorage | undefined {
  const stmt = db.prepare('SELECT * FROM file_storages WHERE id = ?');
  return stmt.get(id) as DbFileStorage | undefined;
}

export function getFileStorages(projectId: string): DbFileStorage[] {
  const stmt = db.prepare('SELECT * FROM file_storages WHERE project_id = ? ORDER BY created_at DESC');
  return stmt.all(projectId) as DbFileStorage[];
}

export function deleteFileStorage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM file_storages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function updateFileStorage(id: string, updates: Partial<DbFileStorage>): boolean {
  const normalizedUpdates: Partial<DbFileStorage> = { ...updates };
  if (normalizedUpdates.object_key !== undefined) {
    normalizedUpdates.object_key = validateObjectKey(normalizedUpdates.object_key, 'object_key');
  }
  if (normalizedUpdates.file_name !== undefined) {
    normalizedUpdates.file_name = normalizeOptionalText(normalizedUpdates.file_name, 'file_name');
  }
  if (normalizedUpdates.content_type !== undefined) {
    normalizedUpdates.content_type = normalizeOptionalText(normalizedUpdates.content_type, 'content_type');
  }
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbFileStorage)[] = ['object_key', 'file_name', 'file_size', 'content_type'];
  for (const key of allowed) {
    if (normalizedUpdates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(normalizedUpdates[key]);
    }
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const stmt = db.prepare(`UPDATE file_storages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// ============================================================================
// BlenderProject CRUD（建模 project，关联 studio project 与 creator service）
// ============================================================================

export function getBlenderProjects(projectId: string): DbBlenderProject[] {
  const stmt = db.prepare('SELECT * FROM blender_projects WHERE project_id = ? ORDER BY created_at DESC');
  return stmt.all(projectId) as DbBlenderProject[];
}

export function getBlenderProject(id: string): DbBlenderProject | null {
  const stmt = db.prepare('SELECT * FROM blender_projects WHERE id = ?');
  const result = stmt.get(id) as DbBlenderProject | undefined;
  return result ?? null;
}

export function createBlenderProject(data: {
  id: string;
  project_id: string;
  blender_project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}): DbBlenderProject {
  const normalizedProjectId = normalizeAndValidateRequiredText(data.project_id, 'project_id');
  const normalizedName = normalizeAndValidateRequiredText(data.name, 'name');
  if (normalizedName.length > MAX_FILENAME_LENGTH) {
    throw new Error(`name 长度不能超过 ${MAX_FILENAME_LENGTH}`);
  }
  const stmt = db.prepare(`
    INSERT INTO blender_projects (id, project_id, blender_project_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(data.id, normalizedProjectId, data.blender_project_id, normalizedName, data.created_at, data.updated_at);
  return {
    ...data,
    project_id: normalizedProjectId,
    name: normalizedName,
  };
}

export function updateBlenderProject(id: string, updates: { blender_project_id?: string }): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.blender_project_id !== undefined) {
    fields.push('blender_project_id = ?');
    values.push(updates.blender_project_id);
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const stmt = db.prepare(`UPDATE blender_projects SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteBlenderProject(id: string): boolean {
  const stmt = db.prepare('DELETE FROM blender_projects WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}
