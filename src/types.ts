// Agent 角色类型
export type AgentRole = 'engineer' | 'architect' | 'game_designer' | 'biz_designer' | 'ceo';
export type AgentStatus = 'idle' | 'working' | 'paused' | 'error';

export interface AgentDefinition {
  id: AgentRole;
  name: string;
  title: string;
  emoji: string;
  color: string;
  description: string;
  responsibilities: string[];
}

export interface AgentState {
  id: AgentRole;
  status: AgentStatus;
  currentTask: string | null;
  lastMessage: string | null;
  lastActiveAt: string | null;
  isPaused: boolean;
}

export interface Agent extends AgentDefinition {
  state: AgentState;
}

// 提案类型
export type ProposalType = 'game_design' | 'biz_design' | 'tech_arch' | 'tech_impl' | 'ceo_review';
export type ProposalStatus =
  | 'pending_review'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'revision_needed'
  | 'user_approved'
  | 'user_rejected';

export interface Proposal {
  id: string;
  project_id: string;
  type: ProposalType;
  title: string;
  content: string;
  author_agent_id: string;
  status: ProposalStatus;
  reviewer_agent_id: string | null;
  review_comment: string | null;
  user_decision: string | null;
  user_comment: string | null;
  version: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

// 游戏成品
export interface Game {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  html_content?: string;
  proposal_id: string | null;
  version: string;
  status: 'draft' | 'published';
  author_agent_id: string;
  created_at: string;
  updated_at: string;
  hasContent?: boolean;
}

// 日志
export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type LogType = 'system' | 'text' | 'tool' | 'tool_result' | 'done' | 'error' | 'user_command';
export interface LogEntry {
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
}

// 指令
export interface Command {
  id: string;
  target_agent_id: string;
  content: string;
  status: 'pending' | 'executing' | 'done' | 'failed';
  result: string | null;
  created_at: string;
  executed_at: string | null;
}

// 消息
export interface AgentMessage {
  id: string;
  agent_session_id: string;
  agent_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  tool_calls: any[] | null;
  created_at: string;
}

// 权限请求
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, any>;
  agentId: AgentRole;
  timestamp: number;
}

// 任务交接
export type HandoffStatus = 'pending' | 'accepted' | 'working' | 'completed' | 'rejected' | 'cancelled';
export type HandoffPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Handoff {
  id: string;
  from_agent_id: AgentRole;
  to_agent_id: AgentRole;
  title: string;
  description: string;
  context: string | null;
  status: HandoffStatus;
  priority: HandoffPriority;
  result: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  source_command_id: string | null;
  created_at: string;
  updated_at: string;
}

// 任务看板
export type TaskType = 'development' | 'testing';
export type TaskStatus = 'todo' | 'developing' | 'testing' | 'blocked' | 'done';

export interface TaskBoardTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  task_type: TaskType;
  status: TaskStatus;
  source_task_id: string | null;
  created_by: string;
  updated_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
}

export interface ProjectSettings {
  project_id: string;
  autopilot_enabled: boolean;
}

// SSE 事件
export interface SSEInitEvent {
  type: 'init';
  agents: AgentState[];
  proposals: Proposal[];
  games: Game[];
  logs: LogEntry[];
  tasks: TaskBoardTask[];
  pendingPermissions: PermissionRequest[];
}

export interface SSEStreamEvent {
  type: 'stream_event';
  event: {
    type: string;
    agentId: AgentRole;
    [key: string]: any;
  };
}

export type SSEEvent =
  | SSEInitEvent
  | SSEStreamEvent
  | { type: 'agent_status_changed'; agentId: AgentRole; state: AgentState }
  | { type: 'proposal_created'; proposal: Proposal }
  | { type: 'proposal_decided'; proposal: Proposal; decision: string; comment: string }
  | { type: 'proposal_reviewed'; proposal: Proposal }
  | { type: 'game_submitted'; game: Game }
  | { type: 'game_updated'; game: Game }
  | { type: 'agent_paused'; agentId: AgentRole }
  | { type: 'agent_resumed'; agentId: AgentRole }
  | { type: 'handoff_created'; handoff: Handoff }
  | { type: 'handoff_updated'; handoff: Handoff }
  | { type: 'task_created'; task: TaskBoardTask }
  | { type: 'task_updated'; task: TaskBoardTask };

// 页面标签
export type TabKey = 'overview' | 'proposals' | 'tasks' | 'games' | 'logs' | 'commands' | 'handoffs' | 'settings';
