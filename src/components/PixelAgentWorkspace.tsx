import React from 'react';
import { Agent, AgentRole, AgentStatus, Handoff } from '../types';

interface Props {
  agents: Agent[];
  handoffs: Handoff[];
}

const MAX_TASK_DISPLAY_LENGTH = 20;
const PROGRESS_WIDTH_BY_STATUS: Record<AgentStatus, string> = {
  working: '66%',
  error: '25%',
  idle: '40%',
  paused: '40%',
};

const WORK_LABEL: Record<AgentStatus, string> = {
  idle: 'IDLE',
  working: 'WRITING',
  paused: 'PAUSE',
  error: 'ERROR',
};

const ROLE_LABEL = 'ROLE';
const MAX_ROLE_BADGE_LENGTH = 4;
const ROLE_COLOR: Record<AgentRole, string> = {
  engineer: '#3B82F6',
  architect: '#10B981',
  game_designer: '#A855F7',
  biz_designer: '#F97316',
  ceo: '#FACC15',
};

const ROLE_SHORT_NAME: Record<string, string> = {
  engineer: 'ENG',
  architect: 'ARCH',
  game_designer: 'GAME',
  biz_designer: 'BIZ',
  ceo: 'CEO',
};

const KNOWN_ROLE_IDS = new Set(['engineer', 'architect', 'game_designer', 'biz_designer', 'ceo']);
const AGENT_COLUMNS = 3;

const SCENE_TILE_CLASSES = [
  'studio2d-tile-floor',
  'studio2d-tile-path',
  'studio2d-tile-floor',
  'studio2d-tile-console',
  'studio2d-tile-path',
  'studio2d-tile-plant',
  'studio2d-tile-floor',
  'studio2d-tile-portal',
  'studio2d-tile-floor',
  'studio2d-tile-path',
  'studio2d-tile-floor',
  'studio2d-tile-path',
  'studio2d-tile-floor',
  'studio2d-tile-floor',
  'studio2d-tile-floor',
];

function getRoleBadgeFromAgentId(agentId: string): string {
  const normalizedId = agentId.toLowerCase();
  if (ROLE_SHORT_NAME[normalizedId]) return ROLE_SHORT_NAME[normalizedId];
  const compact = normalizedId.split('_').filter(Boolean).map(part => part[0]).join('');
  if (compact) return compact.slice(0, MAX_ROLE_BADGE_LENGTH).toUpperCase();
  return normalizedId.slice(0, MAX_ROLE_BADGE_LENGTH).toUpperCase();
}

function truncateTask(task: string | null | undefined, maxLength: number): string {
  if (!task) return 'WAITING';
  return `${task.slice(0, maxLength)}${task.length > maxLength ? '...' : ''}`;
}

function getRoleId(agentId: string): AgentRole {
  const normalized = agentId.toLowerCase() as AgentRole;
  if (KNOWN_ROLE_IDS.has(normalized)) {
    return normalized;
  }
  return 'engineer';
}

function getStatusColor(status: AgentStatus): string {
  if (status === 'working') return '#22C55E';
  if (status === 'error') return '#EF4444';
  if (status === 'paused') return '#F59E0B';
  return '#6B7280';
}

function getSeatPosition(index: number) {
  const row = Math.floor(index / AGENT_COLUMNS);
  const column = index % AGENT_COLUMNS;
  return {
    left: `${16 + column * 31}%`,
    top: `${18 + row * 26}%`,
  };
}

function Studio2DScene({ agents, activeHandoffs }: { agents: Agent[]; activeHandoffs: Handoff[] }) {
  const handoffFlows = activeHandoffs.slice(0, 6);
  return (
    <div className="studio2d-scene">
      <div className="studio2d-grid-bg">
        {SCENE_TILE_CLASSES.map((tileClass, idx) => (
          <div key={idx} className={`studio2d-tile ${tileClass}`} />
        ))}
      </div>
      <div className="studio2d-room-overlay" />

      <div className="studio2d-handoff-layer">
        {handoffFlows.map(h => (
          <div
            key={h.id}
            className={`studio2d-handoff-line studio2d-priority-${h.priority}`}
            aria-label={`handoff from ${h.from_agent_id} to ${h.to_agent_id}`}
          >
            <span className="studio2d-handoff-dot" role="img" aria-label="handoff package">📦</span>
            <span className="studio2d-handoff-label">
              {h.from_agent_id} to {h.to_agent_id}
            </span>
          </div>
        ))}
      </div>

      {agents.map((agent, index) => {
        const status = agent.state?.status || 'idle';
        const brief = truncateTask(agent.state?.currentTask, MAX_TASK_DISPLAY_LENGTH);
        const isWorking = status === 'working';
        const role = getRoleId(agent.id);
        const seat = getSeatPosition(index);
        const avatarStyle: React.CSSProperties = { '--role-color': ROLE_COLOR[role] } as React.CSSProperties;
        return (
          <div
            key={agent.id}
            className={`studio2d-seat-node studio2d-role-${role} ${isWorking ? 'studio2d-working' : ''}`}
            style={seat}
          >
            <div className={`studio2d-avatar status-${status}`} style={avatarStyle}>
              <span className="studio2d-avatar-shadow" />
              <span className="studio2d-avatar-body" />
              <span className="studio2d-avatar-head" />
              <span className="studio2d-avatar-badge">{getRoleBadgeFromAgentId(agent.id)}</span>
            </div>
            <div className="studio2d-bubble">
              <div className="studio2d-name">{agent.name}</div>
              <div className="studio2d-task">{brief}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PixelAgentWorkspace({ agents, handoffs }: Props) {
  const activeHandoffs = handoffs.filter(h => ['pending', 'accepted', 'working'].includes(h.status));

  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs md:text-sm text-gray-300 tracking-wider">2D RPG Studio</h3>
        <span className="text-[10px] md:text-xs text-gray-500">
          AGENTS: {agents.length} · HANDOFFS: {activeHandoffs.length}
        </span>
      </div>

      <div className="studio2d-room rounded-lg border border-gray-800/80 p-3 md:p-4">
        <div className="studio2d-toolbar">
          <span className="studio2d-chip">WORLD: Pixel Office</span>
          <span className="studio2d-chip">MODE: Live RPG</span>
          <span className="studio2d-chip">{activeHandoffs.length > 0 ? 'QUEST FLOW ACTIVE' : 'QUEST FLOW CALM'}</span>
        </div>

        <Studio2DScene agents={agents} activeHandoffs={activeHandoffs} />

        <div className="studio3d-agents-grid">
          {agents.map(agent => {
            const status = agent.state?.status || 'idle';
            const isWorking = status === 'working';
            const brief = truncateTask(agent.state?.currentTask, MAX_TASK_DISPLAY_LENGTH);
            const role = getRoleId(agent.id);
            return (
              <div
                key={agent.id}
                className={`studio3d-seat studio3d-role-${role} ${isWorking ? 'studio3d-working' : ''}`}
              >
                <div className="studio3d-seat-panel">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[10px] text-gray-200 truncate">{agent.name}</div>
                    <div className="text-[9px] text-gray-500">
                      {WORK_LABEL[status]}
                    </div>
                  </div>
                  <div className="text-[9px] text-blue-200/90 uppercase tracking-wide mb-1">{ROLE_LABEL} {getRoleBadgeFromAgentId(agent.id)}</div>
                  <div className="text-[9px] text-gray-400 truncate">{brief}</div>
                  <div className="mt-2 h-1.5 bg-gray-800 border border-gray-700">
                    <div
                      className={`h-full ${isWorking ? 'pixel-progress' : ''}`}
                      style={{ width: PROGRESS_WIDTH_BY_STATUS[status], backgroundColor: getStatusColor(status) }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
