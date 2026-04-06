import * as db from './db.js';
import { agentManager, AgentState } from './agent-manager.js';
import { AgentRole } from './agents.js';

const STAR_OFFICE_UI_URL = process.env.STAR_OFFICE_UI_URL || process.env.VITE_STAR_OFFICE_UI_URL || '';
const STAR_OFFICE_SET_STATE_URL = process.env.STAR_OFFICE_SET_STATE_URL || '';
const STAR_OFFICE_AGENT_PUSH_URL = process.env.STAR_OFFICE_AGENT_PUSH_URL || '';
const STAR_OFFICE_SYNC_DEBOUNCE_MS = Number(process.env.STAR_OFFICE_SYNC_DEBOUNCE_MS || 300);

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

  isEnabled(): boolean {
    return !!setStateUrl || !!agentPushUrl;
  }

  private async postJson(url: string, body: unknown): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }

  private async syncProjectState(projectId: string, reason: string): Promise<void> {
    if (!this.isEnabled()) return;
    const agents = agentManager.getAllAgentStates(projectId);
    const statePayload = buildProjectStatePayload(projectId, agents);
    const requests: Promise<void>[] = [];

    if (setStateUrl) {
      requests.push(this.postJson(setStateUrl, statePayload));
    }
    if (agentPushUrl) {
      requests.push(this.postJson(agentPushUrl, {
        type: 'agent_state_sync',
        reason,
        ...statePayload,
      }));
    }

    const results = await Promise.allSettled(requests);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`[star-office-sync] state sync failed for project=${projectId}, reason=${reason}, failed=${failed.length}/${results.length}`);
    }
  }

  scheduleProjectStateSync(projectId: string, reason: string): void {
    if (!this.isEnabled()) return;
    const prev = this.timerByProject.get(projectId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.timerByProject.delete(projectId);
      void this.syncProjectState(projectId, reason);
    }, STAR_OFFICE_SYNC_DEBOUNCE_MS);
    this.timerByProject.set(projectId, timer);
  }

  notifyAgentStatusChanged(projectId: string, agentId: AgentRole, state: AgentState): void {
    if (!this.isEnabled()) return;
    if (agentPushUrl) {
      void this.postJson(agentPushUrl, {
        type: 'agent_status_changed',
        source: 'game-studio-backend',
        projectId,
        timestamp: new Date().toISOString(),
        agent: {
          id: agentId,
          status: state.status,
          isPaused: state.isPaused,
          currentTask: state.currentTask,
          lastMessage: state.lastMessage,
          lastActiveAt: state.lastActiveAt,
        },
      }).catch((error) => {
        console.warn(`[star-office-sync] agent-push failed project=${projectId} agent=${agentId}:`, (error as Error).message);
      });
    }
    this.scheduleProjectStateSync(projectId, 'agent_status_changed');
  }

  syncAllProjectsOnBoot(): void {
    if (!this.isEnabled()) return;
    const projectIds = db.getAllProjectIds();
    const all = new Set(['default', ...projectIds]);
    for (const projectId of all) {
      void this.syncProjectState(projectId, 'boot');
    }
  }
}

export const starOfficeSyncService = new StarOfficeSyncService();

