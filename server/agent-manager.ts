import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { query, PermissionResult, CanUseTool } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import { AgentRole, AGENT_DEFINITIONS } from './agents.js';
import * as db from './db.js';
import { sseBroadcaster } from './sse-broadcaster.js';
import { createStudioToolsServer, getMemorySummaryForPrompt } from './tools.js';

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
        state.status = dbSession.status === 'working' ? 'idle' : dbSession.status;
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
   * 汇总工具输入参数，便于日志展示
   */
  private summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
    try {
      switch (toolName) {
        case 'Bash':
        case 'Shell':
        case 'Execute':
        case 'execute_command': {
          const cmd = String(input.command || input.cmd || input.script || '');
          return cmd.length > 300 ? cmd.slice(0, 300) + '...' : cmd;
        }
        case 'Read':
        case 'read_file': {
          return String(input.filePath || input.path || input.file_path || '');
        }
        case 'Write':
        case 'write':
        case 'write_to_file': {
          const fp = String(input.filePath || input.path || input.file_path || '');
          const content = String(input.content || '');
          return `${fp} (${content.length} 字符)`;
        }
        case 'Grep':
        case 'grep':
        case 'search':
        case 'search_content': {
          return `pattern="${input.pattern || input.query || ''}"`;
        }
        case 'WebSearch':
        case 'web_search': {
          return String(input.query || input.keyword || '');
        }
        default: {
          const str = JSON.stringify(input);
          return str.length > 300 ? str.slice(0, 300) + '...' : str;
        }
      }
    } catch {
      return String(input);
    }
  }

  /**
   * 汇总工具返回结果，便于日志展示
   */
  private summarizeToolResult(toolName: string, result: string, isError: boolean): string {
    if (isError) {
      return result.length > 200 ? result.slice(0, 200) + '...(错误截断)' : result;
    }
    if (result.length <= 200) return result;
    switch (toolName) {
      case 'Bash':
      case 'Shell':
      case 'Execute':
      case 'execute_command': {
        const lines = result.split('\n');
        if (lines.length > 10) {
          return lines.slice(0, 5).join('\n') + '\n...(省略 ' + (lines.length - 10) + ' 行)\n' + lines.slice(-5).join('\n');
        }
        return result.slice(0, 300) + '...';
      }
      case 'Read':
      case 'read_file': {
        return result.slice(0, 200) + `...(共 ${result.length} 字符)`;
      }
      default: {
        return result.slice(0, 200) + '...(已截断)';
      }
    }
  }

  /**
   * 构建完整的 systemPrompt，注入长期记忆
   */
  private buildSystemPrompt(agentId: AgentRole): string {
    const agentDef = AGENT_DEFINITIONS[agentId];
    const memorySummary = getMemorySummaryForPrompt(agentId);
    return agentDef.systemPrompt + memorySummary;
  }

  /**
   * 向 Agent 发送消息并获取流式响应
   */
  async sendMessage(
    agentId: AgentRole,
    message: string,
    model: string = 'glm-5.0',
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
      // ---- 创建 MCP 自定义工具服务器 ----
      const studioToolsServer = createStudioToolsServer(agentId, (aid, action, detail, level) => {
        this.addLog(aid, action, detail, level);
      });

      // ---- canUseTool 回调 ----
      // 现在逻辑大幅简化：
      // 1. 自定义 MCP 工具：
      //    - 读操作（save_memory, get_*, 无副作用）→ 自动放行
      //    - 写操作 + 有副作用的（create_handoff, submit_proposal, submit_game）→ 需要用户确认
      // 2. CodeBuddy 内置工具走正常权限流程
      const CAN_AUTO_ALLOW = ['save_memory', 'get_memories', 'get_proposals', 'get_pending_handoffs'];

      const canUseTool: CanUseTool = async (toolName, input, options) => {
        if (toolName.startsWith('mcp__studio-tools__')) {
          const actualTool = toolName.replace('mcp__studio-tools__', '');
          if (CAN_AUTO_ALLOW.includes(actualTool)) {
            return { behavior: 'allow', updatedInput: input };
          }
          // 写操作 / 副作用操作 → 走用户确认（复用内置工具的权限请求流程）
        }

        // 发送权限请求事件（CodeBuddy 内置工具 + 需要确认的自定义工具）
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
      const outputDir = path.resolve(process.cwd(), 'output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const stream = query({
        prompt: message,
        options: {
          cwd: outputDir,
          additionalDirectories: [process.cwd()],
          model,
          maxTurns: 15,
          systemPrompt: this.buildSystemPrompt(agentId),
          permissionMode: 'default',
          canUseTool,
          mcpServers: {
            'studio-tools': studioToolsServer
          },
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
                const inputSummary = this.summarizeToolInput(block.name, toolInput);
                this.addLog(agentId, `调用工具: ${block.name}`, inputSummary, 'info');
                const toolEvent: StreamEvent = { type: 'tool', agentId, id: toolId, name: block.name, input: toolInput, status: 'running', streamId };
                this.emit('stream_event', toolEvent);
                if (onEvent) onEvent(toolEvent);
              }
            }
          }
        } else if (msg.type === 'user' && msg.message.role === 'user') {
          const contentBlocks = Array.isArray(msg.message.content) ? msg.message.content : [];
          for (const block of contentBlocks) {
            if (block.type !== 'tool_result') continue;
            const toolId = block.tool_use_id;
            const isError = block.is_error || false;
            const tool = toolCalls.find(t => t.id === toolId) || toolCalls[toolCalls.length - 1];
            if (!tool) continue;
            tool.status = isError ? 'error' : 'completed';
            tool.isError = isError;
            tool.result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
            const resultSummary = this.summarizeToolResult(tool.name, tool.result, isError);
            this.addLog(agentId, `工具结果: ${tool.name}`, resultSummary, isError ? 'error' : 'success');
            const toolResultEvent: StreamEvent = {
              type: 'tool_result', agentId, toolId: tool.id,
              content: tool.result, isError, streamId
            };
            this.emit('stream_event', toolResultEvent);
            if (onEvent) onEvent(toolResultEvent);
          }
        } else if (msg.type === 'result') {
          if (fullResponse.length > 0) {
            const replyPreview = fullResponse.length > 500 ? fullResponse.slice(0, 500) + '...(已截断)' : fullResponse;
            this.addLog(agentId, '最终回复', replyPreview, 'info');
          }
          const doneEvent: StreamEvent = {
            type: 'agent_done',
            agentId,
            streamId,
            duration: msg.duration_ms,
            cost: msg.total_cost_usd
          };
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
