import React, { useState } from 'react';
import { AgentLog, Agent } from '../types';

interface Props {
  logs: AgentLog[];
  agents: Agent[];
}

const LEVEL_CONFIG = {
  info: { label: 'INFO', className: 'text-blue-400', bg: '' },
  warn: { label: 'WARN', className: 'text-yellow-400', bg: 'bg-yellow-900/10' },
  error: { label: 'ERR ', className: 'text-red-400', bg: 'bg-red-900/10' },
  success: { label: 'OK  ', className: 'text-green-400', bg: 'bg-green-900/10' },
};

const AGENT_NAMES: Record<string, string> = {
  engineer: '👨‍💻 工程师',
  architect: '🏗️ 架构师',
  game_designer: '🎮 游戏策划',
  biz_designer: '💼 商业策划',
  ceo: '👔 CEO',
};

export default function LogPanel({ logs, agents }: Props) {
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');

  const filtered = logs.filter(log => {
    if (filterAgent !== 'all' && log.agent_id !== filterAgent) return false;
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    return true;
  });

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col h-[calc(100vh-160px)]">
      {/* 工具栏 */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 shrink-0">
        <span className="font-semibold text-gray-200 text-sm">运行日志</span>

        <select
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none"
        >
          <option value="all">全部 Agent</option>
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none"
        >
          <option value="all">全部级别</option>
          <option value="success">成功</option>
          <option value="info">信息</option>
          <option value="warn">警告</option>
          <option value="error">错误</option>
        </select>

        <span className="text-xs text-gray-600 ml-auto">{filtered.length} 条</span>
      </div>

      {/* 日志内容 */}
      <div className="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-0.5">
        {filtered.map(log => {
          const levelCfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info;
          return (
            <div key={log.id} className={`flex gap-3 px-2 py-1 rounded ${levelCfg.bg}`}>
              <span className="text-gray-600 shrink-0 tabular-nums">
                {new Date(log.created_at).toLocaleTimeString('zh-CN')}
              </span>
              <span className={`${levelCfg.className} shrink-0 font-bold`}>{levelCfg.label}</span>
              <span className="text-purple-400 shrink-0">{AGENT_NAMES[log.agent_id] || log.agent_id}</span>
              <span className="text-gray-300">{log.action}</span>
              {log.detail && (
                <span className="text-gray-500 truncate">{log.detail}</span>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center text-gray-600 py-8">
            <div className="text-3xl mb-2">📜</div>
            暂无日志
          </div>
        )}
      </div>
    </div>
  );
}
