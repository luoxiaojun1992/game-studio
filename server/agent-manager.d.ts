import { EventEmitter } from 'events';
import { AgentRole } from './agents.js';
export type AgentStatus = 'idle' | 'working' | 'paused' | 'error';
export interface AgentState {
    id: AgentRole;
    status: AgentStatus;
    currentTask: string | null;
    lastMessage: string | null;
    lastActiveAt: string | null;
    isPaused: boolean;
}
export interface StreamEvent {
    type: string;
    agentId: AgentRole;
    [key: string]: any;
}
/**
 * Agent 管理器 - 管理所有游戏开发团队 Agent 的运行状态
 */
declare class AgentManager extends EventEmitter {
    private agentStates;
    private pausedAgents;
    private activeStreams;
    private pendingPermissions;
    constructor();
    getAgentState(agentId: AgentRole): AgentState;
    getAllAgentStates(): AgentState[];
    private updateAgentState;
    /**
     * 暂停 Agent
     */
    pauseAgent(agentId: AgentRole): void;
    /**
     * 恢复 Agent
     */
    resumeAgent(agentId: AgentRole): void;
    /**
     * 检查 Agent 是否暂停
     */
    isAgentPaused(agentId: AgentRole): boolean;
    /**
     * 添加日志
     */
    addLog(agentId: AgentRole, action: string, detail: string | null, level?: 'info' | 'warn' | 'error' | 'success'): void;
    /**
     * 汇总工具输入参数，便于日志展示
     */
    private summarizeToolInput;
    /**
     * 汇总工具返回结果，便于日志展示
     */
    private summarizeToolResult;
    /**
     * 构建完整的 systemPrompt，注入长期记忆
     */
    private buildSystemPrompt;
    /**
     * 向 Agent 发送消息并获取流式响应
     */
    sendMessage(agentId: AgentRole, message: string, model?: string, onEvent?: (event: StreamEvent) => void): Promise<string>;
    /**
     * 响应权限请求
     */
    respondToPermission(requestId: string, behavior: 'allow' | 'deny', message?: string): boolean;
    /**
     * 获取待处理的权限请求列表
     */
    getPendingPermissions(): Array<{
        requestId: string;
        toolName: string;
        input: any;
        agentId: AgentRole;
        timestamp: number;
    }>;
}
export declare const agentManager: AgentManager;
export {};
