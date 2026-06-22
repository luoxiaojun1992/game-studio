import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { SEED_COMMON_CONTENT } from './specs/game-engineering-common.js';
import { SEED_H5_CONTENT } from './specs/game-engineering-h5.js';
import { SEED_PHASER_MOBILE_CONTENT } from './specs/game-engineering-phaser-mobile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const MAX_PROJECT_ID_LENGTH = 64;
export const MAX_FILENAME_LENGTH = 50;
// 游戏名称：允许字母、数字、中文、下划线、连字符，不允许路径分隔符和特殊字符
export const GAME_NAME_PATTERN = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/;
export const MAX_VERSION_LENGTH = 30;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const SINGLE_LINE_TITLE_PATTERN = /^[^\r\n]*$/;
export const PROPOSAL_SOURCES = ['manual', 'questionnaire'] as const;
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

export function normalizeAndValidateGameName(value: unknown, fieldName = 'game_name'): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是字符串`);
  }
  const name = value.trim();
  if (!name) {
    throw new Error(`${fieldName} 不能为空`);
  }
  if (name.length > MAX_FILENAME_LENGTH) {
    throw new Error(`${fieldName} 长度不能超过 ${MAX_FILENAME_LENGTH} 个字符`);
  }
  if (!GAME_NAME_PATTERN.test(name)) {
    throw new Error(`${fieldName} 只允许包含字母、数字、中文、下划线和连字符`);
  }
  // 禁止路径穿越
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`${fieldName} 不允许包含路径分隔符或路径穿越字符`);
  }
  return name;
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
    team_builder_model TEXT NOT NULL DEFAULT 'glm-5.0',
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
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 游戏成品表
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    version_number INTEGER NOT NULL,
    description TEXT NOT NULL,
    file_storage_id TEXT,
    sonar_storage_id TEXT,
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
  CREATE INDEX IF NOT EXISTS idx_proposals_source ON proposals(source);
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

  -- Draw.io 图表项目表（关联 studio project 与 drawio service project）
  CREATE TABLE IF NOT EXISTS drawio_projects (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    drawio_project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_drawio_projects_project ON drawio_projects(project_id);

  -- Image 图片处理项目表（关联 studio project 与 image service project）
  CREATE TABLE IF NOT EXISTS image_projects (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    image_project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_image_projects_project ON image_projects(project_id);

  -- Video 视频处理项目表（关联 studio project 与 video service project）
  CREATE TABLE IF NOT EXISTS video_projects (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    video_project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_video_projects_project ON video_projects(project_id);

  -- 策划案附件表（关联策划案与 MinIO 存储文件）
  CREATE TABLE IF NOT EXISTS proposal_attachments (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    file_storage_id TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'drawio_export',
    custom_name TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE,
    FOREIGN KEY (file_storage_id) REFERENCES file_storages(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_proposal_attachments_proposal ON proposal_attachments(proposal_id);

  -- 游戏工程规范数据表（存储公共规范和各游戏类型框架规范的 Markdown 内容）
  CREATE TABLE IF NOT EXISTS game_engineering_specs (
    id TEXT PRIMARY KEY,
    spec_key TEXT NOT NULL UNIQUE,
    game_type TEXT,
    spec_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
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
  source: 'manual' | 'questionnaire';
  created_at: string;
  updated_at: string;
}

export interface DbGame {
  id: string;
  project_id: string;
  version_number: number;
  description: string;
  proposal_id: string | null;
  version: string;
  status: 'draft' | 'published';
  file_storage_id: string | null;
  sonar_storage_id: string | null;
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

export interface DbDrawioProject {
  id: string;
  project_id: string;
  drawio_project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DbImageProject {
  id: string;
  project_id: string;
  image_project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DbVideoProject {
  id: string;
  project_id: string;
  video_project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DbProposalAttachment {
  id: string;
  proposal_id: string;
  file_storage_id: string;
  source_type: 'drawio_export' | 'manual_upload';
  custom_name: string | null;
  created_at: string;
}

const MAX_CUSTOM_NAME_LENGTH = 200;
const CUSTOM_NAME_PATTERN = /^[^\x00-\x1f<>:"|?*\x80-\x9f]{1,200}$/;

export function validateCustomName(value: unknown, fieldName = 'custom_name'): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是字符串`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > MAX_CUSTOM_NAME_LENGTH) {
    throw new Error(`${fieldName} 长度不能超过 ${MAX_CUSTOM_NAME_LENGTH} 字符`);
  }
  if (!CUSTOM_NAME_PATTERN.test(text)) {
    throw new Error(`${fieldName} 包含非法字符（不允许 <>:"|?* 及控制字符）`);
  }
  return text;
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
  team_builder_model: string;
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
  const normalizedSource = validateEnumValue(proposal.source || 'manual', 'source', PROPOSAL_SOURCES);
  const stmt = db.prepare(`
    INSERT INTO proposals (id, project_id, type, title, content, author_agent_id, status, reviewer_agent_id, review_comment, user_decision, user_comment, version, parent_id, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    normalizedSource,
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
    status: normalizedStatus,
    source: normalizedSource
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

export function getGameByVersionNumber(versionNumber: number): DbGame | undefined {
  const stmt = db.prepare('SELECT * FROM games WHERE version_number = ?');
  return stmt.get(versionNumber) as DbGame | undefined;
}

export function getLatestGame(projectId?: string): DbGame | undefined {
  let sql = 'SELECT * FROM games';
  const params: string[] = [];
  if (projectId) {
    sql += ' WHERE project_id = ?';
    params.push(projectId);
  }
  sql += ' ORDER BY version_number DESC LIMIT 1';
  const stmt = db.prepare(sql);
  return stmt.get(...params) as DbGame | undefined;
}

export function createGame(game: DbGame): DbGame {
  const normalizedProjectId = normalizeAndValidateRequiredText(game.project_id, 'project_id');
  const normalizedDescription = normalizeAndValidateRequiredText(game.description, 'description');
  if (normalizedDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`description 长度不能超过 ${MAX_DESCRIPTION_LENGTH}`);
  }
  const normalizedVersion = normalizeAndValidateRequiredText(game.version, 'version');
  if (normalizedVersion.length > MAX_VERSION_LENGTH) {
    throw new Error(`version 长度不能超过 ${MAX_VERSION_LENGTH}`);
  }
  const normalizedStatus = validateEnumValue(game.status, 'status', GAME_STATUSES);
  const normalizedProposalId = normalizeOptionalText(game.proposal_id, 'proposal_id');
  const normalizedFileStorageId = normalizeOptionalText(game.file_storage_id, 'file_storage_id');
  const normalizedSonarStorageId = normalizeOptionalText(game.sonar_storage_id, 'sonar_storage_id');

  // 计算下一个 version_number
  const maxStmt = db.prepare('SELECT MAX(version_number) as max_vn FROM games WHERE project_id = ?');
  const maxResult = maxStmt.get(normalizedProjectId) as { max_vn: number | null };
  const nextVersionNumber = (maxResult.max_vn ?? 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO games (id, project_id, version_number, description, proposal_id, version, status, file_storage_id, sonar_storage_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    game.id,
    normalizedProjectId,
    nextVersionNumber,
    normalizedDescription,
    normalizedProposalId,
    normalizedVersion,
    normalizedStatus,
    normalizedFileStorageId,
    normalizedSonarStorageId,
    game.created_at,
    game.updated_at
  );
  return {
    ...game,
    project_id: normalizedProjectId,
    version_number: nextVersionNumber,
    description: normalizedDescription,
    proposal_id: normalizedProposalId,
    version: normalizedVersion,
    status: normalizedStatus,
    file_storage_id: normalizedFileStorageId,
    sonar_storage_id: normalizedSonarStorageId
  };
}

export function updateGame(id: string, updates: Partial<DbGame>): boolean {
  const normalizedUpdates: Partial<DbGame> = { ...updates };
  if (normalizedUpdates.description !== undefined) {
    normalizedUpdates.description = normalizeAndValidateRequiredText(normalizedUpdates.description, 'description');
    if (normalizedUpdates.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error(`description 长度不能超过 ${MAX_DESCRIPTION_LENGTH}`);
    }
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
  if (normalizedUpdates.sonar_storage_id !== undefined) {
    normalizedUpdates.sonar_storage_id = normalizeOptionalText(normalizedUpdates.sonar_storage_id, 'sonar_storage_id');
  }
  const fields: string[] = [];
  const values: any[] = [];
  const allowed: (keyof DbGame)[] = ['description', 'status', 'version', 'file_storage_id', 'sonar_storage_id'];
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

export function getLogs(projectId: string, agentId?: string, limit = 1000, logType?: LogType): DbLog[] {
  if (agentId && logType) {
    const stmt = db.prepare('SELECT * FROM logs WHERE project_id = ? AND agent_id = ? AND log_type = ? ORDER BY created_at DESC LIMIT ?');
    return (stmt.all(projectId, agentId, limit, logType) as DbLog[]).reverse();
  } else if (agentId) {
    const stmt = db.prepare('SELECT * FROM logs WHERE project_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?');
    return (stmt.all(projectId, agentId, limit) as DbLog[]).reverse();
  } else if (logType) {
    const stmt = db.prepare('SELECT * FROM logs WHERE project_id = ? AND log_type = ? ORDER BY created_at DESC LIMIT ?');
    return (stmt.all(projectId, limit, logType) as DbLog[]).reverse();
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
    team_builder_model: 'glm-5.0',
    created_at: now,
    updated_at: now
  };
  const stmt = db.prepare(`
    INSERT INTO project_settings (project_id, autopilot_enabled, team_builder_model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(settings.project_id, settings.autopilot_enabled, settings.team_builder_model, settings.created_at, settings.updated_at);
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
  updates: Partial<Pick<DbProjectSettings, 'autopilot_enabled' | 'team_builder_model'>>
): DbProjectSettings {
  const safeProjectId = normalizeProjectId(projectId);
  getProjectSettings(safeProjectId);
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.autopilot_enabled !== undefined) {
    fields.push('autopilot_enabled = ?');
    values.push(updates.autopilot_enabled);
  }
  if (updates.team_builder_model !== undefined) {
    fields.push('team_builder_model = ?');
    values.push(updates.team_builder_model);
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

// ============================================================================
// DrawioProject CRUD（图表 project，关联 studio project 与 drawio service）
// ============================================================================

export function getDrawioProjects(projectId: string): DbDrawioProject[] {
  const stmt = db.prepare('SELECT * FROM drawio_projects WHERE project_id = ? ORDER BY created_at DESC');
  return stmt.all(projectId) as DbDrawioProject[];
}

export function getDrawioProject(id: string): DbDrawioProject | null {
  const stmt = db.prepare('SELECT * FROM drawio_projects WHERE id = ?');
  const result = stmt.get(id) as DbDrawioProject | undefined;
  return result ?? null;
}

export function createDrawioProject(data: {
  id: string;
  project_id: string;
  drawio_project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}): DbDrawioProject {
  const normalizedProjectId = normalizeAndValidateRequiredText(data.project_id, 'project_id');
  const normalizedName = normalizeAndValidateRequiredText(data.name, 'name');
  if (normalizedName.length > MAX_FILENAME_LENGTH) {
    throw new Error(`name too long: max ${MAX_FILENAME_LENGTH} chars`);
  }
  const stmt = db.prepare(`
    INSERT INTO drawio_projects (id, project_id, drawio_project_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(data.id, normalizedProjectId, data.drawio_project_id, normalizedName, data.created_at, data.updated_at);
  return {
    id: data.id,
    project_id: normalizedProjectId,
    drawio_project_id: data.drawio_project_id,
    name: normalizedName,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

export function updateDrawioProject(id: string, updates: { drawio_project_id?: string; name?: string }): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.drawio_project_id !== undefined) {
    fields.push('drawio_project_id = ?');
    values.push(updates.drawio_project_id);
  }
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const stmt = db.prepare(`UPDATE drawio_projects SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteDrawioProject(id: string): boolean {
  const stmt = db.prepare('DELETE FROM drawio_projects WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============================================================================
// ImageProject CRUD（图片 project，关联 studio project 与 image service）
// ============================================================================

export function getImageProjects(projectId: string): DbImageProject[] {
  const stmt = db.prepare('SELECT * FROM image_projects WHERE project_id = ? ORDER BY created_at DESC');
  return stmt.all(projectId) as DbImageProject[];
}

export function getImageProject(id: string): DbImageProject | null {
  const stmt = db.prepare('SELECT * FROM image_projects WHERE id = ?');
  const result = stmt.get(id) as DbImageProject | undefined;
  return result ?? null;
}

export function createImageProject(data: {
  id: string;
  project_id: string;
  image_project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}): DbImageProject {
  const normalizedProjectId = normalizeAndValidateRequiredText(data.project_id, 'project_id');
  const normalizedName = normalizeAndValidateRequiredText(data.name, 'name');
  if (normalizedName.length > MAX_FILENAME_LENGTH) {
    throw new Error(`name 长度不能超过 ${MAX_FILENAME_LENGTH}`);
  }
  const stmt = db.prepare(`
    INSERT INTO image_projects (id, project_id, image_project_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(data.id, normalizedProjectId, data.image_project_id, normalizedName, data.created_at, data.updated_at);
  return {
    ...data,
    project_id: normalizedProjectId,
    name: normalizedName,
  };
}

export function updateImageProject(id: string, updates: { image_project_id?: string }): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.image_project_id !== undefined) {
    fields.push('image_project_id = ?');
    values.push(updates.image_project_id);
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const stmt = db.prepare(`UPDATE image_projects SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteImageProject(id: string): boolean {
  const stmt = db.prepare('DELETE FROM image_projects WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============================================================================
// VideoProject CRUD（视频 project，关联 studio project 与 video service）
// ============================================================================

export function getVideoProjects(projectId: string): DbVideoProject[] {
  const stmt = db.prepare('SELECT * FROM video_projects WHERE project_id = ? ORDER BY created_at DESC');
  return stmt.all(projectId) as DbVideoProject[];
}

export function getVideoProject(id: string): DbVideoProject | null {
  const stmt = db.prepare('SELECT * FROM video_projects WHERE id = ?');
  const result = stmt.get(id) as DbVideoProject | undefined;
  return result ?? null;
}

export function createVideoProject(data: {
  id: string;
  project_id: string;
  video_project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}): DbVideoProject {
  const normalizedProjectId = normalizeAndValidateRequiredText(data.project_id, 'project_id');
  const normalizedName = normalizeAndValidateRequiredText(data.name, 'name');
  if (normalizedName.length > MAX_FILENAME_LENGTH) {
    throw new Error(`name 长度不能超过 ${MAX_FILENAME_LENGTH}`);
  }
  const stmt = db.prepare(`
    INSERT INTO video_projects (id, project_id, video_project_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(data.id, normalizedProjectId, data.video_project_id, normalizedName, data.created_at, data.updated_at);
  return { ...data, project_id: normalizedProjectId, name: normalizedName };
}

export function updateVideoProject(id: string, updates: { video_project_id?: string }): boolean {
  const stmt = db.prepare('UPDATE video_projects SET video_project_id = ?, updated_at = ? WHERE id = ?');
  const result = stmt.run(updates.video_project_id, new Date().toISOString(), id);
  return result.changes > 0;
}

export function deleteVideoProject(id: string): boolean {
  const stmt = db.prepare('DELETE FROM video_projects WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============================================================================
// ProposalAttachment CRUD（策划案附件，关联 proposal 与 file_storage）
// ============================================================================

export function createProposalAttachment(data: {
  id: string;
  proposal_id: string;
  file_storage_id: string;
  source_type: 'drawio_export' | 'manual_upload';
  custom_name?: string | null;
  created_at: string;
}): DbProposalAttachment {
  const normalizedProposalId = normalizeAndValidateRequiredText(data.proposal_id, 'proposal_id');
  const normalizedFileStorageId = normalizeAndValidateRequiredText(data.file_storage_id, 'file_storage_id');
  const validatedSourceType = validateEnumValue(data.source_type, 'source_type', ['drawio_export', 'manual_upload']);
  const normalizedCustomName = validateCustomName(data.custom_name ?? null, 'custom_name');
  const stmt = db.prepare(`
    INSERT INTO proposal_attachments (id, proposal_id, file_storage_id, source_type, custom_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(data.id, normalizedProposalId, normalizedFileStorageId, validatedSourceType, normalizedCustomName, data.created_at);
  return {
    id: data.id,
    proposal_id: normalizedProposalId,
    file_storage_id: normalizedFileStorageId,
    source_type: validatedSourceType as 'drawio_export' | 'manual_upload',
    custom_name: normalizedCustomName,
    created_at: data.created_at,
  };
}

export function getProposalAttachments(proposalId: string): DbProposalAttachment[] {
  const stmt = db.prepare('SELECT * FROM proposal_attachments WHERE proposal_id = ? ORDER BY created_at ASC');
  return stmt.all(proposalId) as DbProposalAttachment[];
}

export function countProposalAttachments(proposalId: string): number {
  const stmt = db.prepare('SELECT COUNT(*) as cnt FROM proposal_attachments WHERE proposal_id = ?');
  const row = stmt.get(proposalId) as { cnt: number };
  return row.cnt;
}

export function deleteProposalAttachment(id: string): boolean {
  const stmt = db.prepare('DELETE FROM proposal_attachments WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function deleteProposalAttachmentsByProposal(proposalId: string): number {
  const stmt = db.prepare('DELETE FROM proposal_attachments WHERE proposal_id = ?');
  const result = stmt.run(proposalId);
  return result.changes;
}

// ====== Game Engineering Specs ======

export interface DbGameEngineeringSpec {
  id: string;
  spec_key: string;
  game_type: string | null;
  spec_type: string;
  title: string;
  description: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

/** 获取所有已注册的游戏类型列表，支持可选的 limit 分页 */
export function getGameTypes(limit?: number): Array<{ type: string; description: string }> {
  const sql = limit
    ? 'SELECT game_type, description FROM game_engineering_specs WHERE spec_type = ? LIMIT ?'
    : 'SELECT game_type, description FROM game_engineering_specs WHERE spec_type = ?';
  const stmt = db.prepare(sql);
  const rows = (limit ? stmt.all('framework', limit) : stmt.all('framework')) as Array<{ game_type: string; description: string | null }>;
  return rows.map(r => ({ type: r.game_type, description: r.description || '' }));
}

/** 根据 game_type 获取框架规范内容 */
export function getGameFrameworkSpec(gameType: string): string | null {
  const stmt = db.prepare('SELECT content FROM game_engineering_specs WHERE spec_key = ?');
  const row = stmt.get(`framework:${gameType}`) as { content: string } | undefined;
  return row?.content || null;
}

/** 获取公共规范内容 */
export function getCommonSpec(): string | null {
  const stmt = db.prepare('SELECT content FROM game_engineering_specs WHERE spec_key = ?');
  const row = stmt.get('common') as { content: string } | undefined;
  return row?.content || null;
}

/** 校验 game_type 是否已注册 */
export function isValidGameType(gameType: string): boolean {
  const stmt = db.prepare('SELECT 1 FROM game_engineering_specs WHERE spec_type = ? AND game_type = ?');
  const row = stmt.get('framework', gameType);
  return !!row;
}

function insertGameEngineeringSpec(spec: DbGameEngineeringSpec): void {
  const stmt = db.prepare(`
    INSERT INTO game_engineering_specs (id, spec_key, game_type, spec_type, title, description, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(spec.id, spec.spec_key, spec.game_type, spec.spec_type, spec.title, spec.description, spec.content, spec.created_at, spec.updated_at);
}

/** 种子数据导入：规范内容已嵌入源码，不依赖运行时 .md 文件 */
export function seedGameEngineeringSpecs(): void {
  if (getGameTypes().length > 0) return; // 已有数据，跳过

  const now = new Date().toISOString();

  // 导入公共规范
  insertGameEngineeringSpec({
    id: uuidv4(),
    spec_key: 'common',
    game_type: null,
    spec_type: 'common',
    title: '游戏工程规范 — 公共部分',
    description: '所有游戏类型共享的公共规范',
    content: SEED_COMMON_CONTENT,
    created_at: now,
    updated_at: now,
  });

  // 导入 H5 框架规范
  insertGameEngineeringSpec({
    id: uuidv4(),
    spec_key: 'framework:h5',
    game_type: 'h5',
    spec_type: 'framework',
    title: 'H5 小游戏工程规范',
    description: 'H5 小游戏（浏览器运行）',
    content: SEED_H5_CONTENT,
    created_at: now,
    updated_at: now,
  });

  // 导入 Phaser Mobile 框架规范
  insertGameEngineeringSpec({
    id: uuidv4(),
    spec_key: 'framework:phaser-mobile',
    game_type: 'phaser-mobile',
    spec_type: 'framework',
    title: 'Phaser Mobile 游戏工程规范',
    description: 'Phaser 3 + Capacitor 移动端 2D 游戏',
    content: SEED_PHASER_MOBILE_CONTENT,
    created_at: now,
    updated_at: now,
  });

  console.error('[db] seeded game engineering specs: common=ok, h5=ok');
}

// 启动时自动导入种子数据
seedGameEngineeringSpecs();

// 兼容迁移：为旧库添加 source 列
try {
  db.exec(`ALTER TABLE proposals ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
} catch {
  // 列已存在则忽略
}
