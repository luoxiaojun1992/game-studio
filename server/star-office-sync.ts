import * as db from './db.js';
import { agentManager, AgentState } from './agent-manager.js';
import { AgentRole } from './agents.js';

const STAR_OFFICE_UI_URL = process.env.STAR_OFFICE_UI_URL || process.env.VITE_STAR_OFFICE_UI_URL || 'http://127.0.0.1:19000';
const STAR_OFFICE_SET_STATE_URL = process.env.STAR_OFFICE_SET_STATE_URL || '';
const STAR_OFFICE_AGENT_PUSH_URL = process.env.STAR_OFFICE_AGENT_PUSH_URL || '';
const STAR_OFFICE_SYNC_DEBOUNCE_MS = Number(process.env.STAR_OFFICE_SYNC_DEBOUNCE_MS || 300);
const STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS = Number(process.env.STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS || 10000);
const JOIN_KEY = process.env.STAR_OFFICE_JOIN_KEY || 'ocj_example_team_01';

function resolveUrl(explicitUrl: string, fallbackPath: string): string | null {
  try {
    if (explicitUrl) return new URL(explicitUrl).toString();
    if (!STAR_OFFICE_UI_URL) return null;
    return new URL(fallbackPath, STAR_OFFICE_UI_URL).toString();
  } catch {
    return null;
  }
}

const setStateUrl = resolveUrl(STAR_OFFICE_SET_STATE_URL, '/set_state');
const agentPushUrl = resolveUrl(STAR_OFFICE_AGENT_PUSH_URL, '/agent-push');
const joinAgentUrl = resolveUrl(null, '/join-agent');
const agentsUrl = resolveUrl(null, '/agents');
const healthCheckUrl = resolveUrl(null, '/health');

interface RegisteredAgent {
  projectId: string;
  agentRole: AgentRole;
  agentId: string;
  joinedAt: string;
}

interface RemoteAgentInfo {
  agentId: string;
  name?: string;
  state?: string;
  authStatus?: string;
}

function buildProjectStatePayload(projectId: string, agents: AgentState[]) {
  return {
    source: 'game-studio-backend',
    projectId,
    timestamp: new Date().toISOString(),
    agents: agents.map((agent) => ({
      id: agent.id,
      status: agent.status,
      isPaused: agent.isPaused,
      currentTask: agent.currentTask,
      lastMessage: agent.lastMessage,
      lastActiveAt: agent.lastActiveAt,
    })),
  };
}

class StarOfficeSyncService {
  private timerByProject = new Map<string, NodeJS.Timeout>();
  private registeredAgents = new Map<string, RegisteredAgent>(); // key: `${projectId}:${agentRole}`
  private supervisorTimer: NodeJS.Timeout | null = null;
  private wasOnline = true; // Track if Star-Office-UI was online last check
  private currentProjectId: string = 'default'; // 当前活跃的项目

  // 全局注册锁，防止并发注册
  private globalRegisterLock = false;
  // 等待注册完成的 Promise 队列
  private pendingRegisterResolve: Array<() => void> = [];

  isEnabled(): boolean {
    return !!joinAgentUrl;
  }

  private async postJson(url: string, body: unknown): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
    }
    return data;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * Check if Star-Office-UI is online
   */
  private async isStarOfficeOnline(): Promise<boolean> {
    if (!healthCheckUrl) return false;
    try {
      await this.getJson(healthCheckUrl);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从 Star-Office-UI 获取所有已注册的 agent ID（远程真实状态）
   */
  private async getRemoteAgentIds(): Promise<Set<string>> {
    if (!agentsUrl) return new Set();
    try {
      const agents = await this.getJson(agentsUrl) as RemoteAgentInfo[];
      return new Set(agents.map((a) => a.agentId));
    } catch (error) {
      console.warn('[star-office-sync] Failed to get remote agents:', error);
      return new Set();
    }
  }

  /**
   * 获取全局注册锁，如果已经有注册正在进行，则等待
   */
  private async acquireRegisterLock(): Promise<void> {
    if (!this.globalRegisterLock) {
      this.globalRegisterLock = true;
      return;
    }

    // 等待之前的注册完成
    await new Promise<void>((resolve) => {
      this.pendingRegisterResolve.push(resolve);
    });

    // 被唤醒后，可能锁已经被另一个注册者持有，需要重新检查
    if (this.globalRegisterLock) {
      // 另一个注册者还在持有锁，等待它完成
      await new Promise<void>((resolve) => {
        this.pendingRegisterResolve.push(resolve);
      });
    }
  }

  /**
   * 释放全局注册锁，唤醒下一个等待者
   */
  private releaseRegisterLock(): void {
    const nextResolve = this.pendingRegisterResolve.shift();
    if (nextResolve) {
      nextResolve();
    } else {
      this.globalRegisterLock = false;
    }
  }

  /**
   * Register an agent with Star-Office-UI using join-agent API
   */
  private async registerAgent(projectId: string, agentRole: AgentRole, agentName: string, state: string, detail: string): Promise<string | null> {
    const key = `${projectId}:${agentRole}`;

    // 检查是否已经注册（本地缓存）
    if (this.registeredAgents.has(key)) {
      return this.registeredAgents.get(key)!.agentId;
    }

    if (!joinAgentUrl) {
      console.warn('[star-office-sync] joinAgentUrl not configured');
      return null;
    }

    try {
      const result = await this.postJson(joinAgentUrl, {
        name: agentName,
        joinKey: JOIN_KEY,
        state,
        detail,
      }) as { ok: boolean; agentId?: string; msg?: string };

      if (result.ok && result.agentId) {
        // 再次检查，可能在注册过程中已经被其他注册者注册了
        if (this.registeredAgents.has(key)) {
          return this.registeredAgents.get(key)!.agentId;
        }

        const registered: RegisteredAgent = {
          projectId,
          agentRole,
          agentId: result.agentId,
          joinedAt: new Date().toISOString(),
        };
        this.registeredAgents.set(key, registered);
        console.log(`[star-office-sync] Registered agent ${agentName} with id ${result.agentId}`);
        return result.agentId;
      } else {
        console.warn(`[star-office-sync] Failed to register agent ${agentName}: ${result.msg}`);
        return null;
      }
    } catch (error) {
      console.warn(`[star-office-sync] Error registering agent ${agentName}:`, error);
      return null;
    }
  }

  /**
   * 验证并注册 agent：
   * 1. 获取锁
   * 2. 查询远程 agent 列表
   * 3. 如果 agent 不存在则注册
   * 4. 释放锁
   */
  private async ensureAgentRegisteredAndGetId(projectId: string, agentRole: AgentRole, state: AgentState): Promise<string | null> {
    await this.acquireRegisterLock();
    try {
      const key = `${projectId}:${agentRole}`;
      const localReg = this.registeredAgents.get(key);

      // 查询远程真实状态
      const remoteAgentIds = await this.getRemoteAgentIds();

      // 如果本地有注册但远程没有，说明 Star-Office-UI 重启过或 agent 被删除了
      if (localReg && !remoteAgentIds.has(localReg.agentId)) {
        console.log(`[star-office-sync] Agent ${key} exists locally (${localReg.agentId}) but not in remote, re-registering...`);
        this.registeredAgents.delete(key);
        // 重新注册会获取新的 agentId
      }

      // 如果本地没有注册
      if (!this.registeredAgents.has(key)) {
        const agentName = `${projectId}:${agentRole}`;
        const result = await this.registerAgent(projectId, agentRole, agentName, state.status, state.currentTask || state.lastMessage || '');
        return result;
      }

      return localReg!.agentId;
    } finally {
      this.releaseRegisterLock();
    }
  }

  /**
   * Register all agents from all projects (带锁)
   */
  async syncAllProjectsOnBoot(): Promise<void> {
    if (!this.isEnabled()) return;

    await this.acquireRegisterLock();
    try {
      const projectIds = db.getAllProjectIds();
      const allProjectIds = new Set(['default', ...projectIds]);

      for (const projectId of allProjectIds) {
        const agents = agentManager.getAllAgentStates(projectId);
        for (const state of agents) {
          const key = `${projectId}:${state.id}`;
          await this.registerAgent(projectId, state.id, key, state.status, state.currentTask || state.lastMessage || '');
        }
      }
    } finally {
      this.releaseRegisterLock();
    }
  }

  /**
   * Supervisor: Monitor Star-Office-UI health and re-register agents when it comes back online
   */
  startSupervisor(): void {
    if (!this.isEnabled()) {
      console.log('[star-office-sync] Supervisor disabled (no joinAgentUrl)');
      return;
    }

    console.log(`[star-office-sync] Starting supervisor, health check interval: ${STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS}ms`);

    const checkHealth = async () => {
      const isOnline = await this.isStarOfficeOnline();

      if (this.wasOnline && !isOnline) {
        // Star-Office-UI just went offline
        console.log('[star-office-sync] Star-Office-UI went offline');
      } else if (!this.wasOnline && isOnline) {
        // Star-Office-UI just came back online - re-register agents for current project only
        console.log('[star-office-UI] Star-Office-UI came back online, re-registering agents for current project...');

        // JavaScript 单线程，字符串读取是原子的，不需要锁
        this.registeredAgents.clear(); // Clear cached registrations
        const projectIdToSync = this.currentProjectId;

        // Retry registration multiple times with delay to handle slow startup
        const maxRetries = 5;
        for (let retry = 0; retry < maxRetries; retry++) {
          // 只注册当前项目的 agents
          const agents = agentManager.getAllAgentStates(projectIdToSync);
          for (const state of agents) {
            const key = `${projectIdToSync}:${state.id}`;
            await this.registerAgent(projectIdToSync, state.id, key, state.status, state.currentTask || state.lastMessage || '');
          }

          // Verify by querying remote agents
          const remoteAgentIds = await this.getRemoteAgentIds();
          const currentAgents = agentManager.getAllAgentStates(projectIdToSync);
          const allRegistered = currentAgents.every(agent => {
            const key = `${projectIdToSync}:${agent.id}`;
            const reg = this.registeredAgents.get(key);
            return reg && remoteAgentIds.has(reg.agentId);
          });

          if (allRegistered) {
            console.log('[star-office-sync] All agents re-registered successfully');
            break;
          }

          console.log(`[star-office-sync] Retry ${retry + 1}/${maxRetries} for agent registration...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
        }

        // Sync current state for current project only
        void this.syncProjectState(projectIdToSync, 'supervisor_recovery');
        console.log(`[star-office-sync] Supervisor recovered agents for project: ${projectIdToSync}`);
      }

      this.wasOnline = isOnline;
    };

    // Run health check immediately, then periodically
    void checkHealth();
    this.supervisorTimer = setInterval(checkHealth, STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS);
  }

  stopSupervisor(): void {
    if (this.supervisorTimer) {
      clearInterval(this.supervisorTimer);
      this.supervisorTimer = null;
      console.log('[star-office-sync] Supervisor stopped');
    }
  }

  /**
   * Register a single agent when its status changes (fire and forget for non-critical calls)
   * 只同步当前活跃项目的 Agent 状态
   */
  notifyAgentStatusChanged(projectId: string, agentId: AgentRole, state: AgentState): void {
    if (!this.isEnabled()) return;

    // 检查是否为当前活跃项目，如果不是则跳过
    // JavaScript 单线程，字符串读取是原子的，不需要锁
    if (this.currentProjectId !== projectId) {
      console.log(`[star-office-sync] Skipping sync for non-current project: ${projectId}`);
      return;
    }

    // Schedule a debounced sync for current project only
    this.scheduleProjectStateSync(projectId, 'agent_status_changed');
  }

  /**
   * 同步项目状态：
   * 1. 获取锁
   * 2. 查询远程 agent 列表
   * 3. 如果 agent 不存在则注册
   * 4. 同步 agent 状态
   * 5. 释放锁
   */
  private async syncProjectState(projectId: string, reason: string): Promise<void> {
    if (!this.isEnabled()) return;

    await this.acquireRegisterLock();
    try {
      const agents = agentManager.getAllAgentStates(projectId);

      // 查询远程真实状态
      const remoteAgentIds = await this.getRemoteAgentIds();

      for (const state of agents) {
        const key = `${projectId}:${state.id}`;
        const localReg = this.registeredAgents.get(key);

        // 检查本地缓存的 agent 是否在远程存在
        if (localReg && !remoteAgentIds.has(localReg.agentId)) {
          console.log(`[star-office-sync] Agent ${key} (${localReg.agentId}) not in remote, re-registering...`);
          this.registeredAgents.delete(key);
        }

        // 如果未注册，先注册
        if (!this.registeredAgents.has(key)) {
          const agentName = `${projectId}:${state.id}`;
          await this.registerAgent(projectId, state.id, agentName, state.status, state.currentTask || state.lastMessage || '');
        }

        // 获取（可能是新注册的）agentId
        const reg = this.registeredAgents.get(key);
        if (!reg) {
          console.warn(`[star-office-sync] Failed to register ${key}, skipping state sync`);
          continue;
        }

        // 同步状态
        if (agentPushUrl) {
          try {
            await this.postJson(agentPushUrl, {
              type: 'agent_state_sync',
              reason,
              agentId: reg.agentId,
              joinKey: JOIN_KEY,
              state: state.status,
              detail: state.currentTask || state.lastMessage || '',
              name: key,
            });
          } catch (error) {
            // 如果推送失败（agent 未注册），重新注册并重试
            if (error instanceof Error && error.message.includes('404')) {
              console.warn(`[star-office-sync] Agent ${key} push failed (not registered), re-registering...`);
              this.registeredAgents.delete(key);
              const newAgentId = await this.registerAgent(projectId, state.id, key, state.status, state.currentTask || state.lastMessage || '');
              if (newAgentId) {
                await this.postJson(agentPushUrl, {
                  type: 'agent_state_sync',
                  reason: reason + '_retry',
                  agentId: newAgentId,
                  joinKey: JOIN_KEY,
                  state: state.status,
                  detail: state.currentTask || state.lastMessage || '',
                  name: key,
                });
              }
            } else {
              console.warn(`[star-office-sync] Error pushing state for ${key}:`, error);
            }
          }
        }
      }

      // Also call set_state for overall project state
      if (setStateUrl) {
        const statePayload = buildProjectStatePayload(projectId, agents);
        try {
          await this.postJson(setStateUrl, statePayload);
        } catch (error) {
          console.warn(`[star-office-sync] Error posting set_state for ${projectId}:`, error);
        }
      }
    } finally {
      this.releaseRegisterLock();
    }
  }

  scheduleProjectStateSync(projectId: string, reason: string): void {
    if (!this.isEnabled()) return;

    // 注意：这里直接读取 currentProjectId，不持锁
    // 因为在单线程 JS 中，读取单个字符串引用是原子的
    // 即使读到旧值，setTimeout 后还会再次检查
    const currentProject = this.currentProjectId;

    // 只同步当前活跃项目的状态
    if (currentProject !== projectId) {
      console.log(`[star-office-sync] Skipping schedule sync for non-current project: ${projectId}`);
      return;
    }

    const prev = this.timerByProject.get(projectId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.timerByProject.delete(projectId);
      // 在 setTimeout 回调中再次检查当前项目
      void this.syncProjectStateIfCurrent(projectId, reason);
    }, STAR_OFFICE_SYNC_DEBOUNCE_MS);
    this.timerByProject.set(projectId, timer);
  }

  /**
   * 仅在项目仍为当前活跃项目时同步状态
   */
  private async syncProjectStateIfCurrent(projectId: string, reason: string): Promise<void> {
    // JavaScript 单线程，字符串读取是原子的，不需要锁
    if (this.currentProjectId !== projectId) {
      console.log(`[star-office-sync] Skipping sync - project ${projectId} is no longer current`);
      return;
    }

    await this.syncProjectState(projectId, reason);
  }

  /**
   * 获取当前活跃的项目ID
   * JavaScript 单线程，字符串读取是原子的，不需要锁
   */
  getCurrentProjectId(): string {
    return this.currentProjectId;
  }

  /**
   * 切换项目时重置 Star-Office-UI 中的 Agent 状态
   * 1. 更新 currentProjectId
   * 2. 将旧项目的 Agent 标记为离线/隐藏
   * 3. 同步新项目的 Agent 状态
   */
  async switchProject(fromProjectId: string | null, toProjectId: string): Promise<void> {
    if (!this.isEnabled()) return;

    console.log(`[star-office-sync] Switching project from ${fromProjectId} to ${toProjectId}`);

    await this.acquireRegisterLock();
    try {
      // 更新当前项目（原子操作，不需要额外锁）
      this.currentProjectId = toProjectId;

      // 1. 将旧项目的 Agent 标记为离线（如果提供了旧项目）
      if (fromProjectId) {
        const oldAgents = agentManager.getAllAgentStates(fromProjectId);
        for (const state of oldAgents) {
          const key = `${fromProjectId}:${state.id}`;
          const reg = this.registeredAgents.get(key);
          if (reg && agentPushUrl) {
            try {
              // 将旧项目的 Agent 标记为离线
              await this.postJson(agentPushUrl, {
                type: 'agent_state_sync',
                reason: 'project_switched',
                agentId: reg.agentId,
                joinKey: JOIN_KEY,
                state: 'offline',
                detail: `Switched to project ${toProjectId}`,
                name: key,
              });
              console.log(`[star-office-sync] Marked ${key} as offline`);
            } catch (error) {
              console.warn(`[star-office-sync] Failed to mark ${key} as offline:`, error);
            }
          }
        }
      }

      // 2. 同步新项目的 Agent 状态
      await this.syncProjectState(toProjectId, 'project_switch');
      console.log(`[star-office-sync] Synced new project ${toProjectId} agents to Star-Office-UI`);
    } finally {
      this.releaseRegisterLock();
    }
  }
}

export const starOfficeSyncService = new StarOfficeSyncService();