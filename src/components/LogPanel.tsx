import React, { useState, useEffect, useRef } from 'react';
import { AgentLog, Agent, AgentRole } from '../types';
import { api } from '../config';

interface Props {
  logs: AgentLog[];
  agents: Agent[];
}

interface StreamLogEntry {
  id: string;
  agentId: string;
  time: string;
  type: 'text' | 'tool' | 'tool_result' | 'done' | 'error' | 'info';
  content: string;
  toolName?: string;
  isError?: boolean;
}

const LEVEL_CONFIG = {
  info: { label: 'INFO', className: 'text-blue-400', bg: '' },
  warn: { label: 'WARN', className: 'text-yellow-400', bg: 'bg-yellow-900/10' },
  error: { label: 'ERR ', className: 'text-red-400', bg: 'bg-red-900/10' },
  success: { label: 'OK  ', className: 'text-green-400', bg: 'bg-green-900/10' },
};

const AGENT_NAMES: Record<string, { name: string; emoji: string }> = {
  engineer: { name: '工程师', emoji: '👨‍💻' },
  architect: { name: '架构师', emoji: '🏗️' },
  game_designer: { name: '游戏策划', emoji: '🎮' },
  biz_designer: { name: '商业策划', emoji: '💼' },
  ceo: { name: 'CEO', emoji: '👔' },
};

export default function LogPanel({ logs, agents }: Props) {
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [streamLogs, setStreamLogs] = useState<StreamLogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamLogIdRef = useRef(0);

  // 连接 SSE 获取实时流事件
  useEffect(() => {
    const es = new EventSource(api.observeUrl);

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'stream_event') {
          const se = event.event;
          if (se.type === 'text' && se.agentId) {
            streamLogIdRef.current += 1;
            setStreamLogs(prev => {
              const last = prev[prev.length - 1];
              if (last && last.type === 'text' && last.agentId === se.agentId && last.id === String(streamLogIdRef.current - 1)) {
                // 追加到同一条 text 日志
                return [...prev.slice(0, -1), { ...last, content: last.content + se.content }];
              }
              return [...prev, {
                id: String(streamLogIdRef.current),
                agentId: se.agentId,
                time: new Date().toLocaleTimeString('zh-CN'),
                type: 'text' as const,
                content: se.content
              }].slice(-200);
            });
          } else if (se.type === 'tool' && se.agentId) {
            streamLogIdRef.current += 1;
            const inputStr = se.input ? Object.entries(se.input)
              .map(([k, v]) => `${k}: ${typeof v === 'string' ? (v.length > 200 ? v.slice(0, 200) + '...' : v) : JSON.stringify(v)}`)
              .join('\n') : '';
            setStreamLogs(prev => [...prev, {
              id: String(streamLogIdRef.current),
              agentId: se.agentId,
              time: new Date().toLocaleTimeString('zh-CN'),
              type: 'tool' as const,
              content: inputStr,
              toolName: se.name
            }].slice(-200));
          } else if (se.type === 'tool_result' && se.agentId) {
            streamLogIdRef.current += 1;
            setStreamLogs(prev => [...prev, {
              id: String(streamLogIdRef.current),
              agentId: se.agentId,
              time: new Date().toLocaleTimeString('zh-CN'),
              type: 'tool_result' as const,
              content: (se.content || '').slice(0, 500),
              isError: se.isError
            }].slice(-200));
          } else if (se.type === 'agent_done' && se.agentId) {
            streamLogIdRef.current += 1;
            setStreamLogs(prev => [...prev, {
              id: String(streamLogIdRef.current),
              agentId: se.agentId,
              time: new Date().toLocaleTimeString('zh-CN'),
              type: 'done' as const,
              content: `完成${se.duration ? ` (耗时 ${(se.duration / 1000).toFixed(1)}s)` : ''}`
            }].slice(-200));
          } else if (se.type === 'agent_error' && se.agentId) {
            streamLogIdRef.current += 1;
            setStreamLogs(prev => [...prev, {
              id: String(streamLogIdRef.current),
              agentId: se.agentId,
              time: new Date().toLocaleTimeString('zh-CN'),
              type: 'error' as const,
              content: se.error || '未知错误'
            }].slice(-200));
          }
        }
      } catch {}
    };

    return () => es.close();
  }, []);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [streamLogs, logs, autoScroll]);

  const filteredLogs = logs.filter(log => {
    if (filterAgent !== 'all' && log.agent_id !== filterAgent) return false;
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    return true;
  });

  const filteredStreams = streamLogs.filter(sl => {
    if (filterAgent !== 'all' && sl.agentId !== filterAgent) return false;
    return true;
  });

  // 合并日志和流日志，按时间排序（简化：流日志在后）
  const toggleExpand = (id: string) => {
    setExpandedLog(prev => prev === id ? null : id);
  };

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
            <option key={a.id} value={a.id}>{AGENT_NAMES[a.id]?.emoji} {a.name}</option>
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

        <label className="flex items-center gap-1.5 text-xs text-gray-400 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
            className="rounded border-gray-600"
          />
          自动滚动
        </label>

        <span className="text-xs text-gray-600">{filteredLogs.length + filteredStreams.length} 条</span>
      </div>

      {/* 日志内容 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-0.5"
        onScroll={() => {
          const el = containerRef.current;
          if (el) {
            const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
            if (!isAtBottom && autoScroll) setAutoScroll(false);
          }
        }}
      >
        {/* 系统日志 */}
        {filteredLogs.map(log => {
          const levelCfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info;
          const agentInfo = AGENT_NAMES[log.agent_id];
          const isExpanded = expandedLog === log.id;
          const longDetail = log.detail && log.detail.length > 200;
          return (
            <div
              key={log.id}
              className={`flex gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-800/50 transition-colors ${levelCfg.bg}`}
              onClick={() => longDetail && toggleExpand(log.id)}
            >
              <span className="text-gray-600 shrink-0 tabular-nums">
                {new Date(log.created_at).toLocaleTimeString('zh-CN')}
              </span>
              <span className={`${levelCfg.className} shrink-0 font-bold`}>{levelCfg.label}</span>
              <span className="text-purple-400 shrink-0">{agentInfo?.emoji} {agentInfo?.name || log.agent_id}</span>
              <span className="text-gray-300 shrink-0">{log.action}</span>
              {log.detail && (
                <span className={`text-gray-500 ${longDetail ? '' : 'truncate'}`}>
                  {isExpanded ? log.detail : (longDetail ? log.detail.slice(0, 200) + '...' : log.detail)}
                </span>
              )}
              {longDetail && (
                <span className="text-gray-700 shrink-0">
                  {isExpanded ? '收起 ▲' : '展开 ▼'}
                </span>
              )}
            </div>
          );
        })}

        {/* 流式日志 */}
        {filteredStreams.map(sl => {
          const agentInfo = AGENT_NAMES[sl.agentId];
          const isExpanded = expandedLog === sl.id;
          const isLong = sl.content && sl.content.length > 300;

          if (sl.type === 'text') {
            return (
              <div key={sl.id} className="flex gap-2 px-2 py-0.5">
                <span className="text-gray-600 shrink-0 tabular-nums">{sl.time}</span>
                <span className="text-blue-400 shrink-0 font-bold">MSG </span>
                <span className="text-purple-400 shrink-0">{agentInfo?.emoji} {agentInfo?.name || sl.agentId}</span>
                <span className={`text-gray-300 leading-relaxed whitespace-pre-wrap break-words ${isLong && !isExpanded ? 'line-clamp-4' : ''}`}>
                  {isExpanded ? sl.content : (isLong ? sl.content.slice(0, 300) : sl.content)}
                </span>
                {isLong && (
                  <button
                    onClick={() => toggleExpand(sl.id)}
                    className="text-blue-500 hover:text-blue-400 shrink-0 ml-1"
                  >
                    {isExpanded ? '收起' : '展开'}
                  </button>
                )}
              </div>
            );
          }

          if (sl.type === 'tool') {
            return (
              <div key={sl.id} className="flex gap-2 px-2 py-1 bg-yellow-900/10 rounded">
                <span className="text-gray-600 shrink-0 tabular-nums">{sl.time}</span>
                <span className="text-yellow-400 shrink-0 font-bold">TOOL</span>
                <span className="text-purple-400 shrink-0">{agentInfo?.emoji} {agentInfo?.name || sl.agentId}</span>
                <span className="text-white font-semibold shrink-0">🔧 {sl.toolName}</span>
                {sl.content && (
                  <span className={`text-gray-400 whitespace-pre-wrap break-all ${!isExpanded && sl.content.length > 200 ? 'truncate' : ''}`}>
                    {isExpanded ? sl.content : sl.content.slice(0, 200)}
                    {!isExpanded && sl.content.length > 200 && '...'}
                  </span>
                )}
                {sl.content && sl.content.length > 200 && (
                  <button
                    onClick={() => toggleExpand(sl.id)}
                    className="text-yellow-500 hover:text-yellow-400 shrink-0 ml-1"
                  >
                    {isExpanded ? '收起' : '展开'}
                  </button>
                )}
              </div>
            );
          }

          if (sl.type === 'tool_result') {
            return (
              <div key={sl.id} className={`flex gap-2 px-2 py-1 rounded ${sl.isError ? 'bg-red-900/10' : 'bg-green-900/10'}`}>
                <span className="text-gray-600 shrink-0 tabular-nums">{sl.time}</span>
                <span className={`shrink-0 font-bold ${sl.isError ? 'text-red-400' : 'text-green-400'}`}>
                  {sl.isError ? 'FAIL' : 'DONE'}
                </span>
                <span className="text-purple-400 shrink-0">{agentInfo?.emoji} {agentInfo?.name || sl.agentId}</span>
                <span className={`whitespace-pre-wrap break-all ${sl.isError ? 'text-red-300' : 'text-gray-400'} ${!isExpanded && sl.content.length > 200 ? 'truncate' : ''}`}>
                  {isExpanded ? sl.content : sl.content.slice(0, 200)}
                  {!isExpanded && sl.content.length > 200 && '...'}
                </span>
                {sl.content.length > 200 && (
                  <button
                    onClick={() => toggleExpand(sl.id)}
                    className={`shrink-0 ml-1 ${sl.isError ? 'text-red-500' : 'text-green-500'}`}
                  >
                    {isExpanded ? '收起' : '展开'}
                  </button>
                )}
              </div>
            );
          }

          if (sl.type === 'done') {
            return (
              <div key={sl.id} className="flex gap-2 px-2 py-1 bg-green-900/5 rounded">
                <span className="text-gray-600 shrink-0 tabular-nums">{sl.time}</span>
                <span className="text-green-400 shrink-0 font-bold">DONE</span>
                <span className="text-purple-400 shrink-0">{agentInfo?.emoji} {agentInfo?.name || sl.agentId}</span>
                <span className="text-green-300">{sl.content}</span>
              </div>
            );
          }

          if (sl.type === 'error') {
            return (
              <div key={sl.id} className="flex gap-2 px-2 py-1 bg-red-900/15 rounded">
                <span className="text-gray-600 shrink-0 tabular-nums">{sl.time}</span>
                <span className="text-red-400 shrink-0 font-bold">ERR!</span>
                <span className="text-purple-400 shrink-0">{agentInfo?.emoji} {agentInfo?.name || sl.agentId}</span>
                <span className="text-red-300">{sl.content}</span>
              </div>
            );
          }

          return null;
        })}

        {filteredLogs.length === 0 && filteredStreams.length === 0 && (
          <div className="text-center text-gray-600 py-8">
            <div className="text-3xl mb-2">📜</div>
            暂无日志，发送指令后将在此显示完整日志
          </div>
        )}
      </div>
    </div>
  );
}
