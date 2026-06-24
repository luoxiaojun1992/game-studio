import React from 'react';
import { Agent, AgentStatus, TabKey } from '../types';
import { useI18n } from '../i18n';

interface TeamBuildingIndicatorProps {
  agent: Agent | undefined;
  onTabSwitch: (tab: TabKey) => void;
}

const STATUS_STYLE: Record<AgentStatus, { dot: string; bg: string; text: string; pulse: boolean }> = {
  idle:    { dot: 'bg-gray-500',  bg: 'bg-gray-500/20 border-gray-500/40',  text: 'text-gray-400', pulse: false },
  working: { dot: 'bg-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/40', text: 'text-emerald-300', pulse: true },
  paused:  { dot: 'bg-yellow-400', bg: 'bg-yellow-500/20 border-yellow-500/40', text: 'text-yellow-300', pulse: false },
  error:   { dot: 'bg-red-400',    bg: 'bg-red-500/20 border-red-500/40',    text: 'text-red-300',    pulse: true },
};

const LABEL_ZH: Record<AgentStatus, string> = {
  idle: '团队建设 空闲',
  working: '团队建设 工作中',
  paused: '团队建设 已暂停',
  error: '团队建设 出错',
};

const LABEL_EN: Record<AgentStatus, string> = {
  idle: 'Team Building Idle',
  working: 'Team Building Working',
  paused: 'Team Building Paused',
  error: 'Team Building Error',
};

const TeamBuildingIndicator: React.FC<TeamBuildingIndicatorProps> = ({ agent, onTabSwitch }) => {
  const { l } = useI18n();

  if (!agent) {
    console.log('[DEBUG:TeamBuildingIndicator] render: agent=undefined (hidden)');
    return null;
  }

  const status = agent.state?.status || 'idle';
  const style = STATUS_STYLE[status];
  const label = l(LABEL_ZH[status], LABEL_EN[status]);

  console.log(`[DEBUG:TeamBuildingIndicator] render: status=${status}`);

  return (
    <div
      data-testid="team-building-indicator"
      data-agent-status={status}
      className={`flex items-center gap-1.5 ${style.bg} border rounded-full px-3 py-1 text-xs ${style.text} transition-all duration-300 ${
        status === 'idle' ? 'opacity-60' : ''
      } cursor-pointer`}
      onClick={() => onTabSwitch('team_building')}
    >
      <span
        className={`w-1.5 h-1.5 ${style.dot} rounded-full inline-block ${
          style.pulse ? 'animate-pulse' : ''
        }`}
      />
      <span>🧠 {label}</span>
    </div>
  );
};

export default TeamBuildingIndicator;
