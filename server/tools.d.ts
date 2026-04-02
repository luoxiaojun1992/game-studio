import { type SdkMcpServerResult } from '@tencent-ai/agent-sdk';
import { AgentRole } from './agents.js';
/**
 * 工具回调函数类型 — 用于记录日志
 */
type ToolLogFn = (agentId: string, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
/**
 * 创建工作室 MCP Server，包含所有自定义工具
 *
 * @param agentId - 当前 Agent 的角色 ID，用于标识操作来源
 * @param logFn - 日志记录函数
 */
export declare function createStudioToolsServer(agentId: AgentRole, logFn?: ToolLogFn): SdkMcpServerResult;
/**
 * 获取 Agent 的记忆摘要，用于注入到 systemPrompt
 */
export declare function getMemorySummaryForPrompt(agentId: AgentRole): string;
export {};
