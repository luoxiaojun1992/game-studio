import React from 'react';
import { Agent, AgentStatus, Handoff } from '../types';

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

const ROLE_SHORT_NAME: Record<string, string> = {
  engineer: 'ENG',
  architect: 'ARCH',
  game_designer: 'GAME',
  biz_designer: 'BIZ',
  ceo: 'CEO',
};

function getRoleShortName(agentId: string): string {
  const normalizedId = agentId.toLowerCase();
  if (ROLE_SHORT_NAME[normalizedId]) return ROLE_SHORT_NAME[normalizedId];
  const compact = normalizedId.split('_').filter(Boolean).map(part => part[0]).join('');
  if (compact) return compact.slice(0, 4).toUpperCase();
  return normalizedId.slice(0, 4).toUpperCase();
}

function truncateTask(task: string | null | undefined, maxLength: number): string {
  if (!task) return 'WAITING';
  return `${task.slice(0, maxLength)}${task.length > maxLength ? '...' : ''}`;
}

export default function PixelAgentWorkspace({ agents, handoffs }: Props) {
  const activeHandoffs = handoffs.filter(h => ['pending', 'accepted', 'working'].includes(h.status));

  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs md:text-sm text-gray-300 tracking-wider">3D STUDIO COLLABORATION ROOM</h3>
        <span className="text-[10px] md:text-xs text-gray-500">
          AGENTS: {agents.length} · HANDOFFS: {activeHandoffs.length}
        </span>
      </div>

      <div className="studio3d-room rounded-lg border border-gray-800/80 p-3 md:p-4">
        <div className="studio3d-scene">
          <div className="studio3d-wall" />
          <div className="studio3d-floor" />
          <div className="studio3d-table" />
          <div className="studio3d-monitor" />

          <div className="studio3d-agents-grid">
          {agents.map(agent => {
            const status = agent.state?.status || 'idle';
            const isWorking = status === 'working';
            const brief = truncateTask(agent.state?.currentTask, MAX_TASK_DISPLAY_LENGTH);
            return (
              <div
                key={agent.id}
                className={`studio3d-seat studio3d-seat-${agent.id} ${isWorking ? 'studio3d-working' : ''}`}
              >
                <div className="studio3d-chair" />
                <div className="studio3d-agent-body">
                  <div className="studio3d-agent-head">
                    <span className="studio3d-role-badge">{getRoleShortName(agent.id)}</span>
                  </div>
                  <div className="studio3d-agent-screen">
                    <span className={isWorking ? 'studio3d-typing' : ''}>{isWorking ? 'typing...' : 'standby'}</span>
                  </div>
                </div>
                <div className="studio3d-seat-panel">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[10px] text-gray-200 truncate">{agent.name}</div>
                    <div className="text-[9px] text-gray-500">
                      {WORK_LABEL[agent.state?.status || 'idle']}
                    </div>
                  </div>
                  <div className="text-[9px] text-gray-400 truncate">{brief}</div>
                  <div className="mt-2 h-1.5 bg-gray-800 border border-gray-700">
                    <div
                      className={`h-full ${isWorking ? 'pixel-progress' : ''}`}
                      style={{ width: PROGRESS_WIDTH_BY_STATUS[status], backgroundColor: isWorking ? '#22C55E' : '#6B7280' }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </section>
  );
}
