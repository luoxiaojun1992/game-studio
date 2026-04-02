/**
 * 游戏开发 Agent 团队定义
 * 定义所有 Agent 的角色、系统提示词和职责
 */
export type AgentRole = 'engineer' | 'architect' | 'game_designer' | 'biz_designer' | 'ceo';
export interface AgentDefinition {
    id: AgentRole;
    name: string;
    title: string;
    emoji: string;
    color: string;
    systemPrompt: string;
    description: string;
    responsibilities: string[];
    /** 该 Agent 完成任务后可以移交的目标 Agent */
    handoffTargets?: AgentRole[];
}
export declare const AGENT_DEFINITIONS: Record<AgentRole, AgentDefinition>;
export declare function getAgentById(id: AgentRole): AgentDefinition;
export declare function getAllAgents(): AgentDefinition[];
