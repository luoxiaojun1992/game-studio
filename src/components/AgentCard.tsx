import React from 'react';
import { Agent, AgentRole } from '../types';

interface Props {
  agent: Agent;
  onPauseToggle: () => void;
  onSendCommand: () => void;
  streamLog?: { agentId: AgentRole; content: string; time: string };
}

const STATUS_CONFIG = {
  idle: { label: '空闲', color: 'text-gray-400', dot: 'bg-gray-500', bg: 'border-gray-700' },
  working: { label: '工作中', color: 'text-green-400', dot: 'bg-green-400', bg: 'border-green-800/50' },
  paused: { label: '已暂停', color: 'text-yellow-400', dot: 'bg-yellow-400', bg: 'border-yellow-800/50' },
  error: { label: '出错', color: 'text-red-400', dot: 'bg-red-400', bg: 'border-red-800/50' },
};

export default function AgentCard({ agent, onPauseToggle, onSendCommand, streamLog }: Props) {
  const status = agent.state?.status || 'idle';
  const statusCfg = STATUS_CONFIG[status];
  const isPaused = agent.state?.isPaused;

  return (
    <div
      className={`bg-gray-900 rounded-xl border ${statusCfg.bg} p-4 flex flex-col gap-3 transition-all hover:border-opacity-80`}
      style={{ borderTopColor: agent.color, borderTopWidth: 3 }}
    >
      {/* 头部 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{agent.emoji}</span>
          <div>
            <div className="font-semibold text-white text-sm">{agent.name}</div>
            <div className="text-xs text-gray-500">{agent.title}</div>
          </div>
        </div>

        {/* 状态点 */}
        <div className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${statusCfg.dot} ${status === 'working' ? 'animate-pulse' : ''}`} />
          <span className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</span>
        </div>
      </div>

      {/* 当前任务 */}
      <div className="min-h-[40px]">
        {agent.state?.currentTask ? (
          <div className="text-xs text-gray-400 bg-gray-800 rounded-lg p-2 leading-relaxed">
            <span className="text-gray-500">任务：</span>
            <span className="text-gray-300">{agent.state.currentTask.slice(0, 80)}
              {agent.state.currentTask.length > 80 ? '...' : ''}
            </span>
          </div>
        ) : streamLog ? (
          <div className="text-xs text-gray-500 bg-gray-800/50 rounded-lg p-2 leading-relaxed font-mono">
            {streamLog.content.slice(-80)}
          </div>
        ) : (
          <div className="text-xs text-gray-600 italic">等待任务...</div>
        )}
      </div>

      {/* 职责列表 */}
      <div className="space-y-1">
        {agent.responsibilities?.slice(0, 2).map((r, i) => (
          <div key={i} className="text-xs text-gray-500 flex items-start gap-1">
            <span className="text-gray-600 shrink-0 mt-0.5">•</span>
            <span className="truncate">{r}</span>
          </div>
        ))}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-auto pt-2 border-t border-gray-800">
        <button
          onClick={onSendCommand}
          className="flex-1 text-xs bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/40 text-blue-300 rounded-lg py-1.5 transition-all"
        >
          下达指令
        </button>
        <button
          onClick={onPauseToggle}
          className={`flex-1 text-xs rounded-lg py-1.5 border transition-all ${
            isPaused
              ? 'bg-green-600/20 hover:bg-green-600/40 border-green-600/40 text-green-300'
              : 'bg-yellow-600/20 hover:bg-yellow-600/40 border-yellow-600/40 text-yellow-300'
          }`}
        >
          {isPaused ? '▶ 恢复' : '⏸ 暂停'}
        </button>
      </div>
    </div>
  );
}
