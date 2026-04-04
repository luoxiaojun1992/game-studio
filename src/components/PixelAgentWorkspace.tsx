import React from 'react';
import { Agent, AgentStatus, Handoff } from '../types';
import PixelAgentAvatar from './PixelAgentAvatar';

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
  working: 'WORK',
  paused: 'PAUSE',
  error: 'ERROR',
};

export default function PixelAgentWorkspace({ agents, handoffs }: Props) {
  const activeHandoffs = handoffs.filter(h => ['pending', 'accepted', 'working'].includes(h.status));
  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs md:text-sm text-gray-300 pixel-font tracking-wider">2D PIXEL STUDIO SIMULATION</h3>
        <span className="text-[10px] md:text-xs text-gray-500 pixel-font">
          AGENTS: {agents.length} · HANDOFFS: {activeHandoffs.length}
        </span>
      </div>

      <div className="pixel-grid-bg rounded-lg border border-gray-800/80 p-3 md:p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {agents.map(agent => {
            const status = agent.state?.status || 'idle';
            const isWorking = status === 'working';
            const rawTask = agent.state?.currentTask;
            const brief = rawTask
              ? `${rawTask.slice(0, MAX_TASK_DISPLAY_LENGTH)}${rawTask.length > MAX_TASK_DISPLAY_LENGTH ? '...' : ''}`
              : 'WAITING';
            return (
              <div key={agent.id} className="bg-gray-950/90 border border-gray-800 rounded-lg p-2 min-h-[96px]">
                <div className="flex items-center gap-2 mb-2">
                  <PixelAgentAvatar agentId={agent.id} status={agent.state?.status || 'idle'} size={30} />
                  <div className="min-w-0">
                    <div className="text-[10px] text-gray-300 pixel-font truncate">{agent.name}</div>
                    <div className="text-[9px] text-gray-500 pixel-font">
                      {WORK_LABEL[agent.state?.status || 'idle']}
                      {isWorking ? '...' : ''}
                    </div>
                  </div>
                </div>
                <div className="text-[9px] text-gray-400 pixel-font truncate">{brief}</div>
                <div className="mt-2 h-1.5 bg-gray-800 border border-gray-700">
                  <div
                    className={`h-full ${isWorking ? 'pixel-progress' : ''}`}
                    style={{ width: PROGRESS_WIDTH_BY_STATUS[status], backgroundColor: isWorking ? '#22C55E' : '#6B7280' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
