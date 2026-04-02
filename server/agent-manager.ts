import { EventEmitter } from 'events';
import { query, PermissionResult, CanUseTool } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import { AgentRole, AGENT_DEFINITIONS } from './agents.js';
import * as db from './db.js';

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
class AgentManager extends EventEmitter {
  private agentStates: Map<AgentRole, AgentState> = new Map();
  private pausedAgents: Set<AgentRole> = new Set();
  private activeStreams: Map<string, { agentId: AgentRole; abortController: AbortController }> = new Map();
  private pendingPermissions: Map<string, {
    resolve: (result: PermissionResult) => void;
    reject: (error: Error) => void;
    toolName: string;
    input: Record<string, unknown>;
    agentId: AgentRole;
    timestamp: number;
  }> = new Map();

  constructor() {
    super();
    this.setMaxListeners(50);
    // 初始化所有 Agent 状态
    const agentIds: AgentRole[] = ['engineer', 'architect', 'game_designer', 'biz_designer', 'ceo'];
    for (const agentId of agentIds) {
      this.agentStates.set(agentId, {
        id: agentId,
        status: 'idle',
        currentTask: null,
        lastMessage: null,
        lastActiveAt: null,
        isPaused: false
      });

      // 从数据库恢复状态
      const dbSession = db.getAgentSession(agentId);
      if (dbSession) {
        const state = this.agentStates.get(agentId)!;
        state.status = dbSession.status === 'working' ? 'idle' : dbSession.status; // 重启后重置 working 状态
        state.currentTask = dbSession.current_task;
        state.lastActiveAt = dbSession.updated_at;
      }
    }
  }

  getAgentState(agentId: AgentRole): AgentState {
    return this.agentStates.get(agentId) || {
      id: agentId,
      status: 'idle',
      currentTask: null,
      lastMessage: null,
      lastActiveAt: null,
      isPaused: false
    };
  }

  getAllAgentStates(): AgentState[] {
    return Array.from(this.agentStates.values());
  }

  private updateAgentState(agentId: AgentRole, updates: Partial<AgentState>): void {
    const current = this.agentStates.get(agentId) || { id: agentId } as AgentState;
    const updated = { ...current, ...updates };
    this.agentStates.set(agentId, updated);

    // 持久化到数据库
    const now = new Date().toISOString();
    const existingSession = db.getAgentSession(agentId);
    db.upsertAgentSession({
      id: existingSession?.id || uuidv4(),
      agent_id: agentId,
      sdk_session_id: existingSession?.sdk_session_id || null,
      status: updated.status,
      current_task: updated.currentTask,
      created_at: existingSession?.created_at || now,
      updated_at: now
    });

    // 广播状态变更
    this.emit('agent_status_changed', { agentId, state: updated });
  }

  /**
   * 暂停 Agent
   */
  pauseAgent(agentId: AgentRole): void {
    this.pausedAgents.add(agentId);
    this.updateAgentState(agentId, { status: 'paused', isPaused: true });
    this.addLog(agentId, '暂停工作', null, 'warn');
    this.emit('agent_paused', { agentId });
  }

  /**
   * 恢复 Agent
   */
  resumeAgent(agentId: AgentRole): void {
    this.pausedAgents.delete(agentId);
    this.updateAgentState(agentId, { status: 'idle', isPaused: false });
    this.addLog(agentId, '恢复工作', null, 'info');
    this.emit('agent_resumed', { agentId });
  }

  /**
   * 检查 Agent 是否暂停
   */
  isAgentPaused(agentId: AgentRole): boolean {
    return this.pausedAgents.has(agentId);
  }

  /**
   * 添加日志
   */
  addLog(agentId: AgentRole, action: string, detail: string | null, level: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    const log = {
      id: uuidv4(),
      agent_id: agentId,
      action,
      detail,
      level,
      created_at: new Date().toISOString()
    };
    db.addAgentLog(log);
    this.emit('agent_log', { agentId, log });
  }

  /**
   * 向 Agent 发送消息并获取流式响应
   */
  async sendMessage(
    agentId: AgentRole,
    message: string,
    model: string = 'claude-sonnet-4',
    onEvent?: (event: StreamEvent) => void
  ): Promise<string> {
    if (this.isAgentPaused(agentId)) {
      throw new Error(`Agent ${agentId} 当前已暂停，无法接受任务`);
    }

    const agentDef = AGENT_DEFINITIONS[agentId];
    if (!agentDef) throw new Error(`未知的 Agent: ${agentId}`);

    const streamId = uuidv4();
    this.updateAgentState(agentId, {
      status: 'working',
      currentTask: message.slice(0, 100),
      lastActiveAt: new Date().toISOString()
    });
    this.addLog(agentId, '开始任务', message.slice(0, 200), 'info');

    const abortController = new AbortController();
    this.activeStreams.set(streamId, { agentId, abortController });

    // 获取或创建 Agent 的数据库会话
    let agentDbSession = db.getAgentSession(agentId);
    if (!agentDbSession) {
      const now = new Date().toISOString();
      agentDbSession = db.upsertAgentSession({
        id: uuidv4(),
        agent_id: agentId,
        sdk_session_id: null,
        status: 'working',
        current_task: message.slice(0, 100),
        created_at: now,
        updated_at: now
      });
    }

    // 保存用户消息
    const userMsgId = uuidv4();
    db.createAgentMessage({
      id: userMsgId,
      agent_session_id: agentDbSession.id,
      agent_id: agentId,
      role: 'user',
      content: message,
      model: null,
      tool_calls: null,
      created_at: new Date().toISOString()
    });

    let fullResponse = '';
    let toolCalls: any[] = [];

    try {
      const canUseTool: CanUseTool = async (toolName, input, options) => {
        // 发送权限请求事件
        const requestId = uuidv4();
        const permEvent: StreamEvent = {
          type: 'permission_request',
          agentId,
          requestId,
          toolUseId: options.toolUseID,
          toolName,
          input,
          streamId
        };
        this.emit('stream_event', permEvent);
        if (onEvent) onEvent(permEvent);

        // 等待用户响应
        return new Promise<PermissionResult>((resolve, reject) => {
          this.pendingPermissions.set(requestId, {
            resolve, reject, toolName, input, agentId, timestamp: Date.now()
          });
          // 5分钟超时
          setTimeout(() => {
            if (this.pendingPermissions.has(requestId)) {
              this.pendingPermissions.delete(requestId);
              resolve({ behavior: 'deny', message: '权限请求超时' });
            }
          }, 5 * 60 * 1000);
        });
      };

      const sdkSessionId = agentDbSession.sdk_session_id;

      const stream = query({
        prompt: message,
        options: {
          cwd: process.cwd(),
          model,
          maxTurns: 15,
          systemPrompt: agentDef.systemPrompt,
          permissionMode: 'default',
          canUseTool,
          ...(sdkSessionId ? { resume: sdkSessionId } : {})
        }
      });

      const startEvent: StreamEvent = { type: 'agent_start', agentId, streamId, message };
      this.emit('stream_event', startEvent);
      if (onEvent) onEvent(startEvent);

      for await (const msg of stream) {
        // 检查是否被暂停中断
        if (this.isAgentPaused(agentId)) {
          const pauseEvent: StreamEvent = { type: 'agent_paused_mid_task', agentId, streamId };
          this.emit('stream_event', pauseEvent);
          if (onEvent) onEvent(pauseEvent);
          break;
        }

        if (msg.type === 'system' && (msg as any).subtype === 'init') {
          const newSdkSessionId = (msg as any).session_id;
          if (newSdkSessionId) {
            db.upsertAgentSession({
              ...agentDbSession,
              sdk_session_id: newSdkSessionId,
              updated_at: new Date().toISOString()
            });
            agentDbSession = { ...agentDbSession, sdk_session_id: newSdkSessionId };
          }
        } else if (msg.type === 'assistant') {
          const content = msg.message.content;
          if (typeof content === 'string') {
            fullResponse += content;
            const textEvent: StreamEvent = { type: 'text', agentId, content, streamId };
            this.emit('stream_event', textEvent);
            if (onEvent) onEvent(textEvent);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                fullResponse += block.text;
                const textEvent: StreamEvent = { type: 'text', agentId, content: block.text, streamId };
                this.emit('stream_event', textEvent);
                if (onEvent) onEvent(textEvent);
              } else if (block.type === 'tool_use') {
                const toolId = block.id || uuidv4();
                const toolInput = (block as any).input || {};
                const toolCall = { id: toolId, name: block.name, input: toolInput, status: 'running' };
                toolCalls.push(toolCall);
                const toolEvent: StreamEvent = { type: 'tool', agentId, id: toolId, name: block.name, input: toolInput, status: 'running', streamId };
                this.emit('stream_event', toolEvent);
                if (onEvent) onEvent(toolEvent);
              }
            }
          }
        } else if (msg.type === 'tool_result') {
          const msgAny = msg as any;
          const toolId = msgAny.tool_use_id;
          const isError = msgAny.is_error || false;
          const content = msgAny.content;
          const tool = toolCalls.find(t => t.id === toolId) || toolCalls[toolCalls.length - 1];
          if (tool) {
            tool.status = isError ? 'error' : 'completed';
            tool.isError = isError;
            tool.result = typeof content === 'string' ? content : JSON.stringify(content);
            const toolResultEvent: StreamEvent = {
              type: 'tool_result', agentId, toolId: tool.id,
              content: tool.result, isError, streamId
            };
            this.emit('stream_event', toolResultEvent);
            if (onEvent) onEvent(toolResultEvent);
          }
        } else if (msg.type === 'result') {
          const doneEvent: StreamEvent = { type: 'agent_done', agentId, streamId, duration: msg.duration, cost: msg.cost };
          this.emit('stream_event', doneEvent);
          if (onEvent) onEvent(doneEvent);
        }
      }

      // 保存助手消息
      const assistantMsgId = uuidv4();
      db.createAgentMessage({
        id: assistantMsgId,
        agent_session_id: agentDbSession.id,
        agent_id: agentId,
        role: 'assistant',
        content: fullResponse,
        model,
        tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
        created_at: new Date().toISOString()
      });

      this.updateAgentState(agentId, {
        status: 'idle',
        currentTask: null,
        lastMessage: fullResponse.slice(0, 200),
        lastActiveAt: new Date().toISOString()
      });
      this.addLog(agentId, '任务完成', `完成: ${message.slice(0, 100)}`, 'success');

    } catch (error: any) {
      this.updateAgentState(agentId, {
        status: 'error',
        currentTask: null,
        lastActiveAt: new Date().toISOString()
      });
      this.addLog(agentId, '任务失败', error?.message || String(error), 'error');

      const errorEvent: StreamEvent = { type: 'agent_error', agentId, streamId, error: error?.message || String(error) };
      this.emit('stream_event', errorEvent);
      if (onEvent) onEvent(errorEvent);
      throw error;
    } finally {
      this.activeStreams.delete(streamId);
    }

    return fullResponse;
  }

  /**
   * 响应权限请求
   */
  respondToPermission(requestId: string, behavior: 'allow' | 'deny', message?: string): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    if (behavior === 'allow') {
      pending.resolve({ behavior: 'allow', updatedInput: pending.input });
    } else {
      pending.resolve({ behavior: 'deny', message: message || '用户拒绝了此操作' });
    }
    return true;
  }

  /**
   * 获取待处理的权限请求列表
   */
  getPendingPermissions(): Array<{ requestId: string; toolName: string; input: any; agentId: AgentRole; timestamp: number }> {
    return Array.from(this.pendingPermissions.entries()).map(([requestId, perm]) => ({
      requestId,
      toolName: perm.toolName,
      input: perm.input,
      agentId: perm.agentId,
      timestamp: perm.timestamp
    }));
  }
}

// 单例
export const agentManager = new AgentManager();
