declare const db: any;
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
export declare function getAgentSession(agentId: string): DbAgentSession | undefined;
export declare function getAllAgentSessions(): DbAgentSession[];
export declare function upsertAgentSession(session: DbAgentSession): DbAgentSession;
export declare function updateAgentStatus(agentId: string, status: DbAgentSession['status'], currentTask?: string | null): void;
export declare function getAgentMessages(agentId: string, limit?: number): DbAgentMessage[];
export declare function createAgentMessage(message: DbAgentMessage): DbAgentMessage;
export declare function getAllProposals(): DbProposal[];
export declare function getProposal(id: string): DbProposal | undefined;
export declare function createProposal(proposal: DbProposal): DbProposal;
export declare function updateProposal(id: string, updates: Partial<DbProposal>): boolean;
export declare function getAllGames(): DbGame[];
export declare function getGame(id: string): DbGame | undefined;
export declare function createGame(game: DbGame): DbGame;
export declare function updateGame(id: string, updates: Partial<DbGame>): boolean;
export declare function addAgentLog(log: DbAgentLog): void;
export declare function getAgentLogs(agentId?: string, limit?: number): DbAgentLog[];
export declare function createCommand(command: DbCommand): DbCommand;
export declare function getPendingCommands(agentId: string): DbCommand[];
export declare function updateCommand(id: string, updates: Partial<DbCommand>): boolean;
export declare function getAllCommands(limit?: number): DbCommand[];
export declare function createHandoff(handoff: DbHandoff): DbHandoff;
export declare function getHandoff(id: string): DbHandoff | undefined;
export declare function getAllHandoffs(limit?: number): DbHandoff[];
export declare function getPendingHandoffs(toAgentId?: string): DbHandoff[];
export declare function getHandoffsForAgent(agentId: string, limit?: number): {
    incoming: DbHandoff[];
    outgoing: DbHandoff[];
};
export declare function updateHandoff(id: string, updates: Partial<DbHandoff>): boolean;
/**
 * 清除指定 Agent 的所有消息和会话，重置 SDK session
 */
export declare function clearAgentMessages(agentId: string): boolean;
export declare function createAgentMemory(memory: DbAgentMemory): DbAgentMemory;
export declare function getAgentMemories(agentId: string, category?: string, limit?: number): DbAgentMemory[];
export declare function getAllAgentMemories(limit?: number): DbAgentMemory[];
export declare function deleteAgentMemory(id: string): boolean;
export declare function clearAgentMemories(agentId: string): boolean;
/**
 * 确保产出目录存在
 */
export declare function ensureOutputDir(): string;
/**
 * 保存策划案到产出目录
 */
export declare function saveProposalToFile(proposal: DbProposal): string | null;
/**
 * 保存游戏到产出目录
 */
export declare function saveGameToFile(game: DbGame): string | null;
export default db;
