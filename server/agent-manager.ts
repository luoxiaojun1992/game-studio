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
 * Coordinates per-project agent runtime state, streaming sessions, logs, and permission handshakes.
 */
class AgentManager extends EventEmitter {
  private agentStatesByProject: Map<string, Map<AgentRole, AgentState>> = new Map();
  private pausedAgentsByProject: Map<string, Set<AgentRole>> = new Map();
  private activeStreams: Map<string, { projectId: string; agentId: AgentRole; abortController: AbortController }> = new Map();
  private pendingPermissions: Map<string, {
    resolve: (result: PermissionResult) => void;
    reject: (error: Error) => void;
    toolName: string;
    input: Record<string, unknown>;
    projectId: string;
    agentId: AgentRole;
    timestamp: number;
  }> = new Map();
  private pendingPermissionExpirations: Map<string, NodeJS.Timeout> = new Map();
  private activeAgentStreamsByProject: Map<string, Map<AgentRole, string>> = new Map();

  constructor() {
    super();
    this.setMaxListeners(50);
    this.ensureProjectState('default');
  }

  private normalizeProjectId(projectId?: string): string {
    const raw = (projectId || 'default').trim();
    if (!raw) return 'default';
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(raw)) return 'default';
    return raw;
  }

  private ensureProjectState(projectId: string): void {
    const scopedProjectId = this.normalizeProjectId(projectId);
    if (this.agentStatesByProject.has(scopedProjectId)) return;

    const projectStates: Map<AgentRole, AgentState> = new Map();
    const projectPausedSet: Set<AgentRole> = new Set();
    const projectActiveStreams: Map<AgentRole, string> = new Map();

    const agentIds: AgentRole[] = ['engineer', 'architect', 'game_designer', 'biz_designer', 'ceo'];
    for (const agentId of agentIds) {
      projectStates.set(agentId, {
        id: agentId,
        status: 'idle',
        currentTask: null,
        lastMessage: null,
        lastActiveAt: null,
        isPaused: false
      });
      const dbSession = db.getAgentSession(scopedProjectId, agentId);
      if (dbSession) {
        const state = projectStates.get(agentId)!;
        state.status = dbSession.status === 'working' ? 'idle' : dbSession.status;
        state.currentTask = dbSession.current_task;
        state.lastActiveAt = dbSession.updated_at;
        state.isPaused = dbSession.status === 'paused';
        if (state.isPaused) {
          projectPausedSet.add(agentId);
        }
      }
    }
    this.agentStatesByProject.set(scopedProjectId, projectStates);
    this.pausedAgentsByProject.set(scopedProjectId, projectPausedSet);
    this.activeAgentStreamsByProject.set(scopedProjectId, projectActiveStreams);
  }

  getAgentState(projectId: string, agentId: AgentRole): AgentState {
    const scopedProjectId = this.normalizeProjectId(projectId);
    this.ensureProjectState(scopedProjectId);
    const projectStates = this.agentStatesByProject.get(scopedProjectId)!;
    return projectStates.get(agentId) || {
      id: agentId,
      status: 'idle',
      currentTask: null,
      lastMessage: null,
      lastActiveAt: null,
      isPaused: false
    };
  }

  getAllAgentStates(projectId: string): AgentState[] {
    const scopedProjectId = this.normalizeProjectId(projectId);
    this.ensureProjectState(scopedProjectId);
    return Array.from(this.agentStatesByProject.get(scopedProjectId)!.values());
  }

  private updateAgentState(projectId: string, agentId: AgentRole, updates: Partial<AgentState>): void {
    const scopedProjectId = this.normalizeProjectId(projectId);
    this.ensureProjectState(scopedProjectId);
    const projectStates = this.agentStatesByProject.get(scopedProjectId)!;
    const current = projectStates.get(agentId) || { id: agentId } as AgentState;
    const updated = { ...current, ...updates };
    projectStates.set(agentId, updated);
    const now = new Date().toISOString();
    const existingSession = db.getAgentSession(scopedProjectId, agentId);
    db.upsertAgentSession({
      id: existingSession?.id || uuidv4(),
      project_id: scopedProjectId,
      agent_id: agentId,
      sdk_session_id: existingSession?.sdk_session_id || null,
      status: updated.status,
      current_task: updated.currentTask,
      created_at: existingSession?.created_at || now,
      updated_at: now
    });
    this.emit('agent_status_changed', { projectId: scopedProjectId, agentId, state: updated });
  }

  /**
   * Marks an agent as paused in memory and persistence, then emits a pause event.
   */
  pauseAgent(projectId: string, agentId: AgentRole): void {
    const scopedProjectId = this.normalizeProjectId(projectId);
    this.ensureProjectState(scopedProjectId);
    this.pausedAgentsByProject.get(scopedProjectId)!.add(agentId);
    this.updateAgentState(scopedProjectId, agentId, { status: 'paused', isPaused: true });
    this.addLog(scopedProjectId, agentId, '暂停工作', null, 'warn');
    this.emit('agent_paused', { projectId: scopedProjectId, agentId });
  }

  /**
   * Clears paused state for an agent and returns it to idle status.
   */
  resumeAgent(projectId: string, agentId: AgentRole): void {
    const scopedProjectId = this.normalizeProjectId(projectId);
    this.ensureProjectState(scopedProjectId);
    this.pausedAgentsByProject.get(scopedProjectId)!.delete(agentId);
    this.updateAgentState(scopedProjectId, agentId, { status: 'idle', isPaused: false });
    this.addLog(scopedProjectId, agentId, '恢复工作', null, 'info');
    this.emit('agent_resumed', { projectId: scopedProjectId, agentId });
  }

  /**
   * Returns whether an agent is currently paused for the target project scope.
   */
  isAgentPaused(projectId: string, agentId: AgentRole): boolean {
    const scopedProjectId = this.normalizeProjectId(projectId);
    this.ensureProjectState(scopedProjectId);
    return this.pausedAgentsByProject.get(scopedProjectId)!.has(agentId);
  }

  /**
   * Writes a system-level timeline log entry for a specific agent.
   */
  addLog(projectId: string, agentId: AgentRole, action: string, detail: string | null, level: db.LogLevel = 'info'): void {
    const scopedProjectId = this.normalizeProjectId(projectId);
    const entry: db.DbLog = {
      id: uuidv4(),
      project_id: scopedProjectId,
      agent_id: agentId,
      log_type: 'system',
      level,
      content: detail || '',
      tool_name: null,
      action,
      is_error: level === 'error',
      created_at: new Date().toISOString()
    };
    db.addLog(entry);
  }

  /**
   * Persists a structured agent log item from model/tool execution events.
   */
  addAgentLogEntry(
    projectId: string,
    agentId: string,
    logType: db.LogType,
    content: string,
    extra?: { toolName?: string; isError?: boolean }
  ): void {
    const scopedProjectId = this.normalizeProjectId(projectId);
    const level: db.LogLevel = logType === 'error' || extra?.isError ? 'error' : 'info';
    const entry: db.DbLog = {
      id: uuidv4(),
      project_id: scopedProjectId,
      agent_id: agentId,
      log_type: logType,
      level,
      content,
      tool_name: extra?.toolName || null,
      action: null,
      is_error: extra?.isError || false,
      created_at: new Date().toISOString()
    };
    db.addLog(entry);
  }

  /**
   * Produces a short, readable summary for tool invocation input payloads.
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
   * Produces a compact tool result preview suitable for UI timelines and logs.
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
   * Prevents the engineer agent from finishing while its task-board items remain unfinished.
   */
  private validateEngineerTaskBoardBeforeFinish(projectId: string): string | null {
    const tasks = db.getTaskBoardTasks(projectId)
      .filter(t => t.created_by === 'engineer');
    if (tasks.length === 0) return null;
    const unfinished = tasks.filter(t => t.status !== 'done');
    if (unfinished.length === 0) return null;

    const sample = unfinished.slice(0, 3)
      .map(t => `${t.title}(ID:${t.id}, 状态:${t.status})`)
      .join('；');
    return `检测到软件工程师仍有未完成看板任务，禁止直接结束并转空闲。请先调用 get_tasks / update_task_status 完成状态流转后重试。未完成任务示例：${sample}${unfinished.length > 3 ? '；等' : ''}`;
  }

  private buildHandoffTaskMessage(handoff: db.DbHandoff): string {
    return `【任务交接】你收到了来自 ${handoff.from_agent_id} 的任务交接。\n\n## 任务标题\n${handoff.title}\n\n## 任务描述\n${handoff.description}\n\n${handoff.context ? `## 上下文信息\n${handoff.context}\n\n` : ''}请按照上述要求完成任务。完成后请提交相关成果。`;
  }

  private dispatchAutoHandoffTask(handoff: db.DbHandoff): void {
    this.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '自动接收交接', `从 ${handoff.from_agent_id} 接手: ${handoff.title}`, 'success');
    this.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '开始执行交接任务', `${handoff.title}`, 'success');
    this.sendMessage(
      handoff.project_id,
      handoff.to_agent_id as AgentRole,
      this.buildHandoffTaskMessage(handoff)
    ).catch((error: any) => {
      this.addLog(handoff.project_id, handoff.to_agent_id as AgentRole, '交接任务执行失败', error?.message || String(error), 'error');
    });
  }

  /**
   * Builds the final system prompt by combining static role prompt and project memory summary.
   */
  private buildSystemPrompt(projectId: string, agentId: AgentRole): string {
    const agentDef = AGENT_DEFINITIONS[agentId];
    const memorySummary = getMemorySummaryForPrompt(projectId, agentId);
    return agentDef.systemPrompt + memorySummary;
  }

  /**
   * Runs one agent turn end-to-end, including streaming events, tool permissions, and state transitions.
   */
  async sendMessage(
    projectId: string,
    agentId: AgentRole,
    message: string,
    model: string = 'glm-5.0',
    onEvent?: (event: StreamEvent) => void
  ): Promise<string> {
    const scopedProjectId = this.normalizeProjectId(projectId);
    this.ensureProjectState(scopedProjectId);

    if (this.isAgentPaused(scopedProjectId, agentId)) {
      throw new Error(`Agent ${agentId} 当前已暂停，无法接受任务`);
    }
    this.ensureProjectState(scopedProjectId);
    const projectActiveStreams = this.activeAgentStreamsByProject.get(scopedProjectId)!;
    const existingStreamId = projectActiveStreams.get(agentId);
    if (existingStreamId) {
      throw new Error(`Agent ${agentId} 正在执行其他任务，请稍后重试`);
    }

    const agentDef = AGENT_DEFINITIONS[agentId];
    if (!agentDef) throw new Error(`未知的 Agent: ${agentId}`);

    const streamId = uuidv4();
    projectActiveStreams.set(agentId, streamId);
    this.updateAgentState(scopedProjectId, agentId, {
      status: 'working',
      currentTask: message.slice(0, 100),
      lastActiveAt: new Date().toISOString()
    });
    this.addLog(scopedProjectId, agentId, '开始任务', message.slice(0, 200), 'info');

    const abortController = new AbortController();
    this.activeStreams.set(streamId, { projectId: scopedProjectId, agentId, abortController });
    let streamReleased = false;
    const releaseActiveStream = () => {
      if (streamReleased) return;
      this.activeStreams.delete(streamId);
      const current = this.activeAgentStreamsByProject.get(scopedProjectId)?.get(agentId);
      if (current === streamId) {
        this.activeAgentStreamsByProject.get(scopedProjectId)?.delete(agentId);
      }
      streamReleased = true;
    };
    let agentDbSession = db.getAgentSession(scopedProjectId, agentId);
    if (!agentDbSession) {
      const now = new Date().toISOString();
      agentDbSession = db.upsertAgentSession({
        id: uuidv4(),
        project_id: scopedProjectId,
        agent_id: agentId,
        sdk_session_id: null,
        status: 'working',
        current_task: message.slice(0, 100),
        created_at: now,
        updated_at: now
      });
    }
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
      const studioToolsServer = createStudioToolsServer(
        scopedProjectId,
        agentId,
        (aid, action, detail, level) => {
          this.addLog(scopedProjectId, aid, action, detail, level);
        },
        async (handoff) => {
          this.dispatchAutoHandoffTask(handoff);
        }
      );
      const settings = db.getProjectSettings(scopedProjectId);
      const autopilotEnabled = settings.autopilot_enabled === 1;

      const CAN_AUTO_ALLOW = [
        'save_memory',
        'get_memories',
        'get_proposal',
        'get_proposals',
        'get_handoff',
        'get_handoffs',
        'get_pending_handoffs',
        'get_task',
        'get_tasks',
        ...(autopilotEnabled ? ['create_handoff', 'submit_proposal', 'submit_game'] : []),
        ...(agentId === 'engineer' ? ['split_dev_test_tasks', 'update_task_status'] : [])
      ];
      const STUDIO_TOOL_PREFIX = 'mcp__studio_tools__';
      const STUDIO_TOOL_NAMES = new Set<string>([
        'create_handoff',
        'split_dev_test_tasks',
        'update_task_status',
        'submit_proposal',
        'submit_game'
      ]);
      const READ_ONLY_SDK_TOOLS = ['Read', 'Grep', 'WebSearch', 'WebFetch', 'Glob'];

      const canUseTool: CanUseTool = async (toolName, input, options) => {
        const hasStudioPrefix = toolName.startsWith(STUDIO_TOOL_PREFIX);
        const actualTool = hasStudioPrefix ? toolName.replace(STUDIO_TOOL_PREFIX, '') : toolName;
        const isStudioTool = hasStudioPrefix || STUDIO_TOOL_NAMES.has(actualTool);
        if (isStudioTool) {
          if (CAN_AUTO_ALLOW.includes(actualTool)) {
            return { behavior: 'allow', updatedInput: input };
          }
        }
        if (READ_ONLY_SDK_TOOLS.includes(actualTool)) {
          return { behavior: 'allow', updatedInput: input };
        }
        console.log(`[permission] Agent ${agentId} 请求权限: toolName=${toolName}, actualTool=${actualTool}, input=${JSON.stringify(input).slice(0, 200)}`);
        const requestId = uuidv4();
        db.createPermissionRequest({
          id: requestId,
          project_id: scopedProjectId,
          agent_id: agentId,
          tool_name: toolName,
          input: JSON.stringify(input),
          status: 'pending',
          created_at: new Date().toISOString()
        });
        
        const permEvent: StreamEvent = {
          type: 'permission_request',
          projectId: scopedProjectId,
          agentId,
          requestId,
          toolUseId: options.toolUseID,
          toolName,
          input,
          streamId
        };
        this.emit('stream_event', permEvent);
        if (onEvent) onEvent(permEvent);
        return new Promise<PermissionResult>((resolve, reject) => {
          this.pendingPermissions.set(requestId, {
            resolve, reject, toolName, input, projectId: scopedProjectId, agentId, timestamp: Date.now()
          });
          if (this.pendingPermissionExpirations.has(requestId)) {
            clearTimeout(this.pendingPermissionExpirations.get(requestId)!);
            this.pendingPermissionExpirations.delete(requestId);
          }
          const timer = setTimeout(() => {
            const pending = this.pendingPermissions.get(requestId);
            if (!pending) return;
            this.pendingPermissions.delete(requestId);
            this.pendingPermissionExpirations.delete(requestId);
            db.expirePermissionRequest(requestId);
            pending.resolve({ behavior: 'deny', message: '权限请求已过期（24小时），请重新发起' });
          }, 24 * 60 * 60 * 1000);
          this.pendingPermissionExpirations.set(requestId, timer);
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
           systemPrompt: this.buildSystemPrompt(scopedProjectId, agentId),
          permissionMode: 'default',
          canUseTool,
          mcpServers: {
            'studio-tools': studioToolsServer
          },
          ...(sdkSessionId ? { resume: sdkSessionId } : {})
        }
      });

      const startEvent: StreamEvent = { type: 'agent_start', projectId: scopedProjectId, agentId, streamId, message };
      this.emit('stream_event', startEvent);
      if (onEvent) onEvent(startEvent);

      for await (const msg of stream) {
         if (this.isAgentPaused(scopedProjectId, agentId)) {
           const pauseEvent: StreamEvent = { type: 'agent_paused_mid_task', projectId: scopedProjectId, agentId, streamId };
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
              const textEvent: StreamEvent = { type: 'text', projectId: scopedProjectId, agentId, content, streamId };
              this.emit('stream_event', textEvent);
              if (onEvent) onEvent(textEvent);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                fullResponse += block.text;
                const textEvent: StreamEvent = { type: 'text', projectId: scopedProjectId, agentId, content: block.text, streamId };
                this.emit('stream_event', textEvent);
                if (onEvent) onEvent(textEvent);
              } else if (block.type === 'tool_use') {
                const toolId = block.id || uuidv4();
                const toolInput = (block as any).input || {};
                const toolCall = { id: toolId, name: block.name, input: toolInput, status: 'running' };
                toolCalls.push(toolCall);
                const inputSummary = this.summarizeToolInput(block.name, toolInput);
                this.addLog(scopedProjectId, agentId, `调用工具: ${block.name}`, inputSummary, 'info');
                const toolEvent: StreamEvent = { type: 'tool', projectId: scopedProjectId, agentId, id: toolId, name: block.name, input: toolInput, status: 'running', streamId };
                this.emit('stream_event', toolEvent);
                if (onEvent) onEvent(toolEvent);
                this.addAgentLogEntry(scopedProjectId, agentId, 'tool', inputSummary, { toolName: block.name });
              }
            }
          }
        } else if (msg.type === 'user') {
          const contentBlocks = Array.isArray(msg.message.content) ? msg.message.content : [];
          for (const block of contentBlocks) {
            if (block.type !== 'tool_result') continue;
            const toolId = block.tool_use_id;
            const isError = block.is_error || false;
            const tool = toolCalls.find(t => t.id === toolId) || toolCalls[toolCalls.length - 1];
            if (!tool) continue;
            tool.status = isError ? 'error' : 'completed';
            tool.isError = isError;
            tool.result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? null);
            const resultSummary = this.summarizeToolResult(tool.name, tool.result, isError);
            this.addLog(scopedProjectId, agentId, `工具结果: ${tool.name}`, resultSummary, isError ? 'error' : 'success');
            const toolResultEvent: StreamEvent = {
              type: 'tool_result', projectId: scopedProjectId, agentId, toolId: tool.id,
              content: tool.result, isError, streamId
            };
            this.emit('stream_event', toolResultEvent);
            if (onEvent) onEvent(toolResultEvent);
            const resultContent = (tool.result || '').slice(0, 500);
            this.addAgentLogEntry(scopedProjectId, agentId, 'tool_result', resultContent, { toolName: tool.name, isError });
          }
        } else if (msg.type === 'result') {
          if (fullResponse.length > 0) {
            this.addAgentLogEntry(scopedProjectId, agentId, 'text', fullResponse);
          }
          if (fullResponse.length > 0) {
            const replyPreview = fullResponse.length > 500 ? fullResponse.slice(0, 500) + '...(已截断)' : fullResponse;
            this.addLog(scopedProjectId, agentId, '最终回复', replyPreview, 'info');
          }
          const doneEvent: StreamEvent = {
            type: 'agent_done',
            projectId: scopedProjectId,
            agentId,
            streamId,
            duration: msg.duration_ms,
            cost: msg.total_cost_usd
          };
          this.emit('stream_event', doneEvent);
          if (onEvent) onEvent(doneEvent);
          const doneContent = `完成${msg.duration_ms ? ` (耗时 ${(msg.duration_ms / 1000).toFixed(1)}s)` : ''}`;
          this.addAgentLogEntry(scopedProjectId, agentId, 'done', doneContent);
        }
      }
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

      if (agentId === 'engineer') {
        const guardWarning = this.validateEngineerTaskBoardBeforeFinish(scopedProjectId);
        if (guardWarning) {
          this.addLog(scopedProjectId, agentId, '任务板提醒', guardWarning, 'warn');
        }
      }

      releaseActiveStream();
      this.updateAgentState(scopedProjectId, agentId, {
        status: 'idle',
        currentTask: null,
        lastMessage: fullResponse.slice(0, 200),
        lastActiveAt: new Date().toISOString()
      });
      this.addLog(scopedProjectId, agentId, '任务完成', `完成: ${message.slice(0, 100)}`, 'success');

    } catch (error: any) {
      releaseActiveStream();
      this.updateAgentState(scopedProjectId, agentId, {
        status: 'error',
        currentTask: null,
        lastActiveAt: new Date().toISOString()
      });
      this.addLog(scopedProjectId, agentId, '任务失败', error?.message || String(error), 'error');

      const errorEvent: StreamEvent = { type: 'agent_error', projectId: scopedProjectId, agentId, streamId, error: error?.message || String(error) };
      this.emit('stream_event', errorEvent);
      if (onEvent) onEvent(errorEvent);
      this.addAgentLogEntry(scopedProjectId, agentId, 'error', error?.message || String(error), { isError: true });
      throw error;
    } finally {
      releaseActiveStream();
    }

    return fullResponse;
  }

  /**
   * Resolves a pending permission request and forwards the decision to the waiting stream.
   */
  respondToPermission(requestId: string, behavior: 'allow' | 'deny', message?: string, projectId?: string, updatedInput?: Record<string, unknown>): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      const dbRequest = db.getPermissionRequest(requestId);
      if (!dbRequest || dbRequest.status !== 'pending') return false;
      if (projectId && this.normalizeProjectId(projectId) !== this.normalizeProjectId(dbRequest.project_id)) {
        return false;
      }
      db.respondToPermissionRequest(requestId, behavior, message, updatedInput);
      return true;
    }
    if (projectId && this.normalizeProjectId(projectId) !== this.normalizeProjectId(pending.projectId)) {
      return false;
    }
    this.pendingPermissions.delete(requestId);
    const timer = this.pendingPermissionExpirations.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.pendingPermissionExpirations.delete(requestId);
    }
    db.respondToPermissionRequest(requestId, behavior, message, updatedInput);
    if (behavior === 'allow') {
      pending.resolve({ behavior: 'allow', updatedInput: updatedInput || pending.input });
    } else {
      pending.resolve({ behavior: 'deny', message: message || '用户拒绝了此操作' });
    }
    return true;
  }

  /**
   * Returns pending permission requests by merging in-memory live requests with persisted DB records.
   */
  getPendingPermissions(projectId?: string): Array<{ requestId: string; toolName: string; input: any; projectId: string; agentId: AgentRole; timestamp: number }> {
    const scopedProjectId = projectId ? this.normalizeProjectId(projectId) : undefined;
    const dbRequests = scopedProjectId 
      ? db.getPendingPermissionRequests(scopedProjectId)
      : [];
    const memoryRequests = Array.from(this.pendingPermissions.entries())
      .filter(([, perm]) => !scopedProjectId || perm.projectId === scopedProjectId)
      .map(([requestId, perm]) => ({
        requestId,
        toolName: perm.toolName,
        input: perm.input,
        projectId: perm.projectId,
        agentId: perm.agentId,
        timestamp: perm.timestamp
      }));
    const dbFormattedRequests = dbRequests.map(req => ({
      requestId: req.id,
      toolName: req.tool_name,
      input: JSON.parse(req.input),
      projectId: req.project_id,
      agentId: req.agent_id as AgentRole,
      timestamp: new Date(req.created_at).getTime()
    }));
    const memoryIds = new Set(memoryRequests.map(r => r.requestId));
    const uniqueDbRequests = dbFormattedRequests.filter(r => !memoryIds.has(r.requestId));
    
    return [...memoryRequests, ...uniqueDbRequests];
  }
}
export const agentManager = new AgentManager();
