import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_PROJECT_ID_LENGTH = 64;
const MAX_FILENAME_LENGTH = 50;
const MAX_VERSION_LENGTH = 30;
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
    created_at TEXT NOT NULL
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
    executed_at TEXT
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
    responded_at TEXT
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

  CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(agent_session_id);
  CREATE INDEX IF NOT EXISTS idx_agent_messages_agent ON agent_messages(agent_id);
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
function hasColumn(tableName, columnName) {
    const pragmaSql = tableName === 'proposals'
        ? 'PRAGMA table_info(proposals)'
        : tableName === 'games'
            ? 'PRAGMA table_info(games)'
            : tableName === 'agent_sessions'
                ? 'PRAGMA table_info(agent_sessions)'
                : tableName === 'commands'
                    ? 'PRAGMA table_info(commands)'
                    : tableName === 'handoffs'
                        ? 'PRAGMA table_info(handoffs)'
                        : tableName === 'agent_memories'
                            ? 'PRAGMA table_info(agent_memories)'
                            : 'PRAGMA table_info(task_board_tasks)';
    const rows = db.prepare(pragmaSql).all();
    return rows.some(row => row.name === columnName);
}
function ensureProjectColumns() {
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
function ensureProjectIsolationColumns() {
    if (!hasColumn('agent_sessions', 'project_id'))
        db.exec(`ALTER TABLE agent_sessions ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
    if (!hasColumn('commands', 'project_id'))
        db.exec(`ALTER TABLE commands ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
    if (!hasColumn('handoffs', 'project_id'))
        db.exec(`ALTER TABLE handoffs ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
    if (!hasColumn('agent_memories', 'project_id'))
        db.exec(`ALTER TABLE agent_memories ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';`);
    db.exec(`UPDATE agent_sessions SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
    db.exec(`UPDATE commands SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
    db.exec(`UPDATE handoffs SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
    db.exec(`UPDATE agent_memories SET project_id = 'default' WHERE project_id IS NULL OR project_id = '';`);
}
ensureProjectIsolationColumns();
ensureProject('default');
export function getAgentSession(projectId, agentId) {
    const stmt = db.prepare('SELECT * FROM agent_sessions WHERE project_id = ? AND agent_id = ? ORDER BY updated_at DESC LIMIT 1');
    return stmt.get(projectId, agentId);
}
export function getAllAgentSessions() {
    const stmt = db.prepare('SELECT * FROM agent_sessions ORDER BY updated_at DESC');
    return stmt.all();
}
export function upsertAgentSession(session) {
    const existing = getAgentSession(session.project_id, session.agent_id);
    if (existing) {
        const stmt = db.prepare(`
      UPDATE agent_sessions SET
        sdk_session_id = ?, status = ?, current_task = ?, updated_at = ?
      WHERE id = ?
    `);
        stmt.run(session.sdk_session_id, session.status, session.current_task, new Date().toISOString(), existing.id);
        return { ...existing, ...session, id: existing.id };
    }
    else {
        const stmt = db.prepare(`
      INSERT INTO agent_sessions (id, project_id, agent_id, sdk_session_id, status, current_task, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(session.id, session.project_id, session.agent_id, session.sdk_session_id, session.status, session.current_task, session.created_at, session.updated_at);
        return session;
    }
}
export function updateAgentStatus(projectId, agentId, status, currentTask) {
    const existing = getAgentSession(projectId, agentId);
    if (existing) {
        const stmt = db.prepare('UPDATE agent_sessions SET status = ?, current_task = ?, updated_at = ? WHERE id = ?');
        stmt.run(status, currentTask !== undefined ? currentTask : existing.current_task, new Date().toISOString(), existing.id);
    }
}
export function getAgentMessages(projectId, agentId, limit = 50) {
    const session = getAgentSession(projectId, agentId);
    if (!session)
        return [];
    const stmt = db.prepare('SELECT * FROM agent_messages WHERE agent_session_id = ? ORDER BY created_at ASC LIMIT ?');
    return stmt.all(session.id, limit);
}
export function createAgentMessage(message) {
    const stmt = db.prepare(`
    INSERT INTO agent_messages (id, agent_session_id, agent_id, role, content, model, tool_calls, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(message.id, message.agent_session_id, message.agent_id, message.role, message.content, message.model, message.tool_calls, message.created_at);
    return message;
}
export function getAllProposals() {
    const stmt = db.prepare('SELECT * FROM proposals ORDER BY created_at DESC');
    return stmt.all();
}
export function getProposal(id) {
    const stmt = db.prepare('SELECT * FROM proposals WHERE id = ?');
    return stmt.get(id);
}
export function createProposal(proposal) {
    const stmt = db.prepare(`
    INSERT INTO proposals (id, project_id, type, title, content, author_agent_id, status, reviewer_agent_id, review_comment, user_decision, user_comment, version, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(proposal.id, proposal.project_id, proposal.type, proposal.title, proposal.content, proposal.author_agent_id, proposal.status, proposal.reviewer_agent_id, proposal.review_comment, proposal.user_decision, proposal.user_comment, proposal.version, proposal.parent_id, proposal.created_at, proposal.updated_at);
    return proposal;
}
export function updateProposal(id, updates) {
    const fields = [];
    const values = [];
    const allowed = ['status', 'reviewer_agent_id', 'review_comment', 'user_decision', 'user_comment', 'content', 'title'];
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(updates[key]);
        }
    }
    if (fields.length === 0)
        return false;
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const stmt = db.prepare(`UPDATE proposals SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
}
export function getAllGames() {
    const stmt = db.prepare('SELECT * FROM games ORDER BY created_at DESC');
    return stmt.all();
}
export function getGame(id) {
    const stmt = db.prepare('SELECT * FROM games WHERE id = ?');
    return stmt.get(id);
}
export function createGame(game) {
    const stmt = db.prepare(`
    INSERT INTO games (id, project_id, name, description, html_content, proposal_id, version, status, author_agent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(game.id, game.project_id, game.name, game.description, game.html_content, game.proposal_id, game.version, game.status, game.author_agent_id, game.created_at, game.updated_at);
    return game;
}
export function updateGame(id, updates) {
    const fields = [];
    const values = [];
    const allowed = ['name', 'description', 'html_content', 'status', 'version'];
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(updates[key]);
        }
    }
    if (fields.length === 0)
        return false;
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const stmt = db.prepare(`UPDATE games SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
}
export function addLog(log) {
    const stmt = db.prepare(`
    INSERT INTO logs (id, project_id, agent_id, log_type, level, content, tool_name, action, is_error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(log.id, log.project_id, log.agent_id, log.log_type, log.level, log.content, log.tool_name || null, log.action || null, log.is_error ? 1 : 0, log.created_at);
}
export function getLogs(projectId, agentId, limit = 1000) {
    if (agentId) {
        const stmt = db.prepare('SELECT * FROM logs WHERE project_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?');
        return stmt.all(projectId, agentId, limit).reverse();
    }
    else {
        const stmt = db.prepare('SELECT * FROM logs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
        return stmt.all(projectId, limit).reverse();
    }
}
export function deleteLogs(projectId, agentId) {
    if (agentId) {
        const stmt = db.prepare('DELETE FROM logs WHERE project_id = ? AND agent_id = ?');
        stmt.run(projectId, agentId);
        return;
    }
    const stmt = db.prepare('DELETE FROM logs WHERE project_id = ?');
    stmt.run(projectId);
}
export function createCommand(command) {
    const stmt = db.prepare(`
    INSERT INTO commands (id, project_id, target_agent_id, content, status, result, created_at, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(command.id, command.project_id, command.target_agent_id, command.content, command.status, command.result, command.created_at, command.executed_at);
    return command;
}
export function getPendingCommands(projectId, agentId) {
    const stmt = db.prepare("SELECT * FROM commands WHERE project_id = ? AND target_agent_id = ? AND status = 'pending' ORDER BY created_at ASC");
    return stmt.all(projectId, agentId);
}
export function updateCommand(id, updates) {
    const fields = [];
    const values = [];
    if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
    }
    if (updates.result !== undefined) {
        fields.push('result = ?');
        values.push(updates.result);
    }
    if (updates.executed_at !== undefined) {
        fields.push('executed_at = ?');
        values.push(updates.executed_at);
    }
    if (fields.length === 0)
        return false;
    values.push(id);
    const stmt = db.prepare(`UPDATE commands SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
}
export function getAllCommands(projectId, limit = 50) {
    const stmt = db.prepare('SELECT * FROM commands WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(projectId, limit);
}
export function createPermissionRequest(request) {
    const stmt = db.prepare(`
    INSERT INTO permission_requests (id, project_id, agent_id, tool_name, input, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(request.id, request.project_id, request.agent_id, request.tool_name, request.input, request.status, request.created_at);
    return request;
}
export function getPendingPermissionRequests(projectId) {
    const stmt = db.prepare("SELECT * FROM permission_requests WHERE project_id = ? AND status = 'pending' ORDER BY created_at ASC");
    return stmt.all(projectId);
}
export function respondToPermissionRequest(id, behavior, message, updatedInput) {
    const stmt = db.prepare(`
    UPDATE permission_requests 
    SET status = ?, behavior = ?, message = ?, updated_input = ?, responded_at = ?
    WHERE id = ? AND status = 'pending'
  `);
    const result = stmt.run(behavior === 'allow' ? 'allowed' : 'denied', behavior, message || null, updatedInput ? JSON.stringify(updatedInput) : null, new Date().toISOString(), id);
    return result.changes > 0;
}
export function expirePermissionRequest(id) {
    const stmt = db.prepare("UPDATE permission_requests SET status = 'expired' WHERE id = ? AND status = 'pending'");
    const result = stmt.run(id);
    return result.changes > 0;
}
export function getPermissionRequest(id) {
    const stmt = db.prepare('SELECT * FROM permission_requests WHERE id = ?');
    const result = stmt.get(id);
    return result || null;
}
export function createHandoff(handoff) {
    const stmt = db.prepare(`
    INSERT INTO handoffs (id, project_id, from_agent_id, to_agent_id, title, description, context, status, priority, result, accepted_at, completed_at, source_command_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(handoff.id, handoff.project_id, handoff.from_agent_id, handoff.to_agent_id, handoff.title, handoff.description, handoff.context, handoff.status, handoff.priority, handoff.result, handoff.accepted_at, handoff.completed_at, handoff.source_command_id, handoff.created_at, handoff.updated_at);
    return handoff;
}
export function getHandoff(id) {
    const stmt = db.prepare('SELECT * FROM handoffs WHERE id = ?');
    return stmt.get(id);
}
export function getAllHandoffs(projectId, limit = 50) {
    const stmt = db.prepare('SELECT * FROM handoffs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(projectId, limit);
}
export function getPendingHandoffs(projectId, toAgentId) {
    if (toAgentId) {
        const stmt = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND to_agent_id = ? AND status IN ('pending', 'accepted', 'working') ORDER BY created_at DESC");
        return stmt.all(projectId, toAgentId);
    }
    const stmt = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND status IN ('pending', 'accepted', 'working') ORDER BY created_at DESC");
    return stmt.all(projectId);
}
export function getHandoffsForAgent(projectId, agentId, limit = 20) {
    const incoming = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND to_agent_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, agentId, limit);
    const outgoing = db.prepare("SELECT * FROM handoffs WHERE project_id = ? AND from_agent_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, agentId, limit);
    return { incoming, outgoing };
}
export function updateHandoff(id, updates) {
    const fields = [];
    const values = [];
    const allowed = ['status', 'result', 'accepted_at', 'completed_at', 'description', 'context', 'priority'];
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(updates[key]);
        }
    }
    if (fields.length === 0)
        return false;
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const stmt = db.prepare(`UPDATE handoffs SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
}
/**
 */
export function clearAgentMessages(projectId, agentId) {
    const session = getAgentSession(projectId, agentId);
    if (!session)
        return true;
    const deleteMsgs = db.prepare('DELETE FROM agent_messages WHERE agent_session_id = ?');
    deleteMsgs.run(session.id);
    const updateSession = db.prepare('UPDATE agent_sessions SET sdk_session_id = NULL, current_task = NULL, updated_at = ? WHERE id = ?');
    updateSession.run(new Date().toISOString(), session.id);
    return true;
}
export function createAgentMemory(memory) {
    const stmt = db.prepare(`
    INSERT INTO agent_memories (id, project_id, agent_id, category, content, importance, source_task, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(memory.id, memory.project_id, memory.agent_id, memory.category, memory.content, memory.importance, memory.source_task, memory.created_at, memory.updated_at);
    return memory;
}
export function getAgentMemories(projectId, agentId, category, limit = 50) {
    if (category) {
        const stmt = db.prepare('SELECT * FROM agent_memories WHERE project_id = ? AND agent_id = ? AND category = ? ORDER BY importance DESC, created_at DESC LIMIT ?');
        return stmt.all(projectId, agentId, category, limit);
    }
    const stmt = db.prepare('SELECT * FROM agent_memories WHERE project_id = ? AND agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?');
    return stmt.all(projectId, agentId, limit);
}
export function getAllAgentMemories(projectId, limit = 100) {
    const stmt = db.prepare('SELECT * FROM agent_memories WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(projectId, limit);
}
export function deleteAgentMemory(id) {
    const stmt = db.prepare('DELETE FROM agent_memories WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
}
export function clearAgentMemories(projectId, agentId) {
    const stmt = db.prepare('DELETE FROM agent_memories WHERE project_id = ? AND agent_id = ?');
    stmt.run(projectId, agentId);
    return true;
}
export function createTaskBoardTask(task) {
    const stmt = db.prepare(`
    INSERT INTO task_board_tasks (
      id, project_id, title, description, task_type, status, source_task_id,
      created_by, updated_by, started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(task.id, task.project_id, task.title, task.description, task.task_type, task.status, task.source_task_id, task.created_by, task.updated_by, task.started_at, task.completed_at, task.created_at, task.updated_at);
    return task;
}
export function getTaskBoardTask(id) {
    const stmt = db.prepare('SELECT * FROM task_board_tasks WHERE id = ?');
    return stmt.get(id);
}
export function getTaskBoardTasks(projectId) {
    if (projectId) {
        const stmt = db.prepare('SELECT * FROM task_board_tasks WHERE project_id = ? ORDER BY created_at DESC');
        return stmt.all(projectId);
    }
    const stmt = db.prepare('SELECT * FROM task_board_tasks ORDER BY created_at DESC');
    return stmt.all();
}
export function getAllProjectIds() {
    const rows = db.prepare(`
    SELECT id AS project_id FROM projects
    UNION
    SELECT project_id FROM proposals WHERE project_id IS NOT NULL
    UNION
    SELECT project_id FROM games WHERE project_id IS NOT NULL
    UNION
    SELECT project_id FROM task_board_tasks WHERE project_id IS NOT NULL
    ORDER BY project_id ASC
  `).all();
    const ids = rows
        .map(r => r.project_id)
        .filter(id => id !== '');
    if (!ids.includes('default'))
        ids.unshift('default');
    return ids;
}
function createDefaultProjectSettings(projectId) {
    const now = new Date().toISOString();
    const settings = {
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
export function getProjectSettings(projectId) {
    const safeProjectId = normalizeProjectId(projectId);
    const stmt = db.prepare('SELECT * FROM project_settings WHERE project_id = ?');
    const found = stmt.get(safeProjectId);
    if (found)
        return found;
    return createDefaultProjectSettings(safeProjectId);
}
export function updateProjectSettings(projectId, updates) {
    const safeProjectId = normalizeProjectId(projectId);
    getProjectSettings(safeProjectId);
    const fields = [];
    const values = [];
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
export function createProject(project) {
    const stmt = db.prepare(`
    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
    stmt.run(project.id, project.name, project.created_at, project.updated_at);
    return project;
}
export function getProject(projectId) {
    const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
    return stmt.get(projectId);
}
export function ensureProject(projectId) {
    const safeProjectId = normalizeProjectId(projectId);
    if (!safeProjectId)
        return;
    if (!getProject(safeProjectId)) {
        const now = new Date().toISOString();
        createProject({ id: safeProjectId, name: safeProjectId, created_at: now, updated_at: now });
    }
    getProjectSettings(safeProjectId);
}
export function updateTaskBoardTask(id, updates) {
    const fields = [];
    const values = [];
    const allowed = ['title', 'description', 'status', 'updated_by', 'started_at', 'completed_at'];
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(updates[key]);
        }
    }
    if (fields.length === 0)
        return false;
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const stmt = db.prepare(`UPDATE task_board_tasks SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
}
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
function sanitizeFilename(value, maxLength) {
    return value
        .replace(/\0/g, '')
        .replace(/[\x00-\x1f\x80-\x9f]/g, '_')
        .replace(/[<>:"/\\|?*]/g, '_')
        .slice(0, maxLength);
}
function normalizeProjectId(projectId) {
    const raw = (projectId || 'default').trim();
    if (!raw)
        return 'default';
    if (raw.length > MAX_PROJECT_ID_LENGTH)
        return 'default';
    if (!PROJECT_ID_PATTERN.test(raw))
        return 'default';
    return raw;
}
function resolveSafePath(baseDir, fileName) {
    const resolvedBase = path.resolve(baseDir);
    const candidate = path.resolve(baseDir, fileName);
    if (!candidate.startsWith(`${resolvedBase}${path.sep}`) && candidate !== resolvedBase) {
        throw new Error('非法文件路径');
    }
    return candidate;
}
/**
 */
export function ensureOutputDir() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    return OUTPUT_DIR;
}
function ensureProjectOutputDirs(projectId) {
    const root = ensureOutputDir();
    const safeProjectId = normalizeProjectId(projectId);
    const projectDir = path.join(root, safeProjectId);
    const proposalsDir = path.join(projectDir, 'proposals');
    const gamesDir = path.join(projectDir, 'games');
    [projectDir, proposalsDir, gamesDir].forEach((dir) => {
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
    });
    return { projectDir, proposalsDir, gamesDir };
}
/**
 */
export function saveProposalToFile(proposal) {
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
    }
    catch {
        return null;
    }
}
/**
 */
export function saveGameToFile(game) {
    const { gamesDir } = ensureProjectOutputDirs(game.project_id);
    const safeName = sanitizeFilename(game.name, MAX_FILENAME_LENGTH);
    const safeVersion = sanitizeFilename(game.version, MAX_VERSION_LENGTH);
    const filePath = resolveSafePath(gamesDir, `${safeName}_v${safeVersion}_${game.id.slice(0, 8)}.html`);
    try {
        fs.writeFileSync(filePath, game.html_content, 'utf-8');
        return filePath;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=db.js.map