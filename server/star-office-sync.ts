import * as db from './db.js';
import { agentManager, AgentState } from './agent-manager.js';
import { AgentRole } from './agents.js';

const STAR_OFFICE_UI_URL = process.env.STAR_OFFICE_UI_URL || 'http://127.0.0.1:19000';
const STAR_OFFICE_SYNC_DEBOUNCE_MS = Number(process.env.STAR_OFFICE_SYNC_DEBOUNCE_MS || 300);
const STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS = Number(process.env.STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS || 10000);
const JOIN_KEY = process.env.STAR_OFFICE_JOIN_KEY || 'ocj_example_team_01';

function buildUrl(path: string): string | null {
  try {
    if (!STAR_OFFICE_UI_URL) return null;
    return new URL(path, STAR_OFFICE_UI_URL).toString();
  } catch {
    return null;
  }
}

const setStateUrl = buildUrl('/set_state');
const agentPushUrl = buildUrl('/agent-push');
const joinAgentUrl = buildUrl('/join-agent');
const agentsUrl = buildUrl('/agents');
const healthCheckUrl = buildUrl('/health');

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
  private currentProjectId: string = 'default';
  private globalRegisterLock = false;
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
   * Fetches current remote agent IDs from Star-Office-UI for reconciliation.
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
   * Acquires a process-wide registration lock to serialize register/sync operations.
   */
  private async acquireRegisterLock(): Promise<void> {
    if (!this.globalRegisterLock) {
      this.globalRegisterLock = true;
      return;
    }
    await new Promise<void>((resolve) => {
      this.pendingRegisterResolve.push(resolve);
    });
    if (this.globalRegisterLock) {
      await new Promise<void>((resolve) => {
        this.pendingRegisterResolve.push(resolve);
      });
    }
  }

  /**
   * Releases the registration lock and wakes the next waiter if present.
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
      console.warn('[star-office-sync] Error registering agent %s:', agentName, error);
      return null;
    }
  }

  /**
   * Ensures local cache and remote registration are consistent, then returns the remote agent ID.
   */
  private async ensureAgentRegisteredAndGetId(projectId: string, agentRole: AgentRole, state: AgentState): Promise<string | null> {
    await this.acquireRegisterLock();
    try {
      const key = `${projectId}:${agentRole}`;
      const localReg = this.registeredAgents.get(key);
      const remoteAgentIds = await this.getRemoteAgentIds();
      if (localReg && !remoteAgentIds.has(localReg.agentId)) {
        console.log(`[star-office-sync] Agent ${key} exists locally (${localReg.agentId}) but not in remote, re-registering...`);
        this.registeredAgents.delete(key);
      }
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
   * Registers all known project agents during service startup.
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
        this.registeredAgents.clear(); // Clear cached registrations
        const projectIdToSync = this.currentProjectId;

        // Retry registration multiple times with delay to handle slow startup
        const maxRetries = 5;
        for (let retry = 0; retry < maxRetries; retry++) {
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
   */
  notifyAgentStatusChanged(projectId: string, agentId: AgentRole, state: AgentState): void {
    if (!this.isEnabled()) return;
    if (this.currentProjectId !== projectId) {
      console.log(`[star-office-sync] Skipping sync for non-current project: ${projectId}`);
      return;
    }

    // Schedule a debounced sync for current project only
    this.scheduleProjectStateSync(projectId, 'agent_status_changed');
  }

  /**
   * Syncs all agents in one project to Star-Office-UI and publishes aggregate project state.
   */
  private async syncProjectState(projectId: string, reason: string): Promise<void> {
    if (!this.isEnabled()) return;

    await this.acquireRegisterLock();
    try {
      const agents = agentManager.getAllAgentStates(projectId);
      const remoteAgentIds = await this.getRemoteAgentIds();

      for (const state of agents) {
        const key = `${projectId}:${state.id}`;
        const localReg = this.registeredAgents.get(key);
        if (localReg && !remoteAgentIds.has(localReg.agentId)) {
          console.log(`[star-office-sync] Agent ${key} (${localReg.agentId}) not in remote, re-registering...`);
          this.registeredAgents.delete(key);
        }
        if (!this.registeredAgents.has(key)) {
          const agentName = `${projectId}:${state.id}`;
          await this.registerAgent(projectId, state.id, agentName, state.status, state.currentTask || state.lastMessage || '');
        }
        const reg = this.registeredAgents.get(key);
        if (!reg) {
          console.warn(`[star-office-sync] Failed to register ${key}, skipping state sync`);
          continue;
        }
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
              console.warn('[star-office-sync] Error pushing state for %s:', key, error);
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
          console.warn('[star-office-sync] Error posting set_state for %s:', projectId, error);
        }
      }
    } finally {
      this.releaseRegisterLock();
    }
  }

  scheduleProjectStateSync(projectId: string, reason: string): void {
    if (!this.isEnabled()) return;
    const currentProject = this.currentProjectId;
    if (currentProject !== projectId) {
      console.log(`[star-office-sync] Skipping schedule sync for non-current project: ${projectId}`);
      return;
    }

    const prev = this.timerByProject.get(projectId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.timerByProject.delete(projectId);
      void this.syncProjectStateIfCurrent(projectId, reason);
    }, STAR_OFFICE_SYNC_DEBOUNCE_MS);
    this.timerByProject.set(projectId, timer);
  }

  /**
   * Guards state sync execution so stale timers do not sync non-current projects.
   */
  private async syncProjectStateIfCurrent(projectId: string, reason: string): Promise<void> {
    if (this.currentProjectId !== projectId) {
      console.log(`[star-office-sync] Skipping sync - project ${projectId} is no longer current`);
      return;
    }

    await this.syncProjectState(projectId, reason);
  }

  /**
   * Returns the project currently considered active for outbound synchronization.
   */
  getCurrentProjectId(): string {
    return this.currentProjectId;
  }

  /**
   * Switches active project context and propagates offline/online transitions to remote UI.
   */
  async switchProject(fromProjectId: string | null, toProjectId: string): Promise<void> {
    if (!this.isEnabled()) return;

    console.log(`[star-office-sync] Switching project from ${fromProjectId} to ${toProjectId}`);

    await this.acquireRegisterLock();
    try {
      this.currentProjectId = toProjectId;
      if (fromProjectId) {
        const oldAgents = agentManager.getAllAgentStates(fromProjectId);
        for (const state of oldAgents) {
          const key = `${fromProjectId}:${state.id}`;
          const reg = this.registeredAgents.get(key);
          if (reg && agentPushUrl) {
            try {
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
              console.warn('[star-office-sync] Failed to mark %s as offline:', key, error);
            }
          }
        }
      }
      await this.syncProjectState(toProjectId, 'project_switch');
      console.log(`[star-office-sync] Synced new project ${toProjectId} agents to Star-Office-UI`);
    } finally {
      this.releaseRegisterLock();
    }
  }
}

export const starOfficeSyncService = new StarOfficeSyncService();
