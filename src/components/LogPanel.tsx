import React, { useState, useEffect, useRef } from 'react';
import { LogEntry, Agent } from '../types';
import { api } from '../config';
import { useI18n } from '../i18n';

interface Props {
  logs: LogEntry[];
  agents: Agent[];
  projectId: string;
}

const LEVEL_CONFIG: Record<string, { label: string; className: string; bg: string }> = {
  info: { label: 'INFO', className: 'text-blue-400', bg: '' },
  warn: { label: 'WARN', className: 'text-yellow-400', bg: 'bg-yellow-900/10' },
  error: { label: 'ERR ', className: 'text-red-400', bg: 'bg-red-900/10' },
  success: { label: 'OK  ', className: 'text-green-400', bg: 'bg-green-900/10' },
};

export default function LogPanel({ logs: externalLogs, agents, projectId }: Props) {
  const { l, locale, isZh } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>(externalLogs);
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // 同步外部 logs（后端已在 SSE 初始化时返回最新 1000 条）
  useEffect(() => {
    setLogs(externalLogs);
  }, [externalLogs]);

  // SSE 实时追加流日志（合并到同一个列表）
  useEffect(() => {
    const es = new EventSource(api.observeUrl(projectId));

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'stream_event') {
          const se = event.event;
          if (se.type === 'text' && se.agentId) {
            // 追加到同一条 text 日志，或新建
            setLogs(prev => {
              const last = prev[prev.length - 1];
              if (last && last.log_type === 'text' && last.agent_id === se.agentId) {
                return [...prev.slice(0, -1), { ...last, content: last.content + se.content }].slice(-1000);
              }
              return [...prev, {
                id: se.id || String(Date.now()) + Math.random(),
                project_id: projectId,
                agent_id: se.agentId,
                log_type: 'text' as const,
                level: 'info' as const,
                content: se.content,
                tool_name: null,
                action: null,
                is_error: false,
                created_at: new Date().toISOString(),
              }].slice(-1000);
            });
          } else if (se.type === 'tool' && se.agentId) {
            const inputStr = se.input ? Object.entries(se.input)
              .map(([k, v]) => `${k}: ${typeof v === 'string' ? (v.length > 200 ? v.slice(0, 200) + '...' : v) : JSON.stringify(v)}`)
              .join('\n') : '';
            setLogs(prev => [...prev, {
              id: se.id || String(Date.now()) + Math.random(),
              project_id: projectId,
              agent_id: se.agentId,
              log_type: 'tool' as const,
              level: 'info' as const,
              content: inputStr,
              tool_name: se.name || null,
              action: null,
              is_error: false,
              created_at: new Date().toISOString(),
            }].slice(-1000));
          } else if (se.type === 'tool_result' && se.agentId) {
            setLogs(prev => [...prev, {
              id: se.id || String(Date.now()) + Math.random(),
              project_id: projectId,
              agent_id: se.agentId,
              log_type: 'tool_result' as const,
              level: se.isError ? 'error' as const : 'success' as const,
              content: (se.content || '').slice(0, 500),
              tool_name: null,
              action: null,
              is_error: !!se.isError,
              created_at: new Date().toISOString(),
            }].slice(-1000));
          } else if (se.type === 'agent_done' && se.agentId) {
            setLogs(prev => [...prev, {
              id: se.id || String(Date.now()) + Math.random(),
              project_id: projectId,
              agent_id: se.agentId,
              log_type: 'done' as const,
              level: 'success' as const,
              content: l('完成', 'Completed') + `${se.duration ? (isZh ? ` (耗时 ${(se.duration / 1000).toFixed(1)}s)` : ` (${(se.duration / 1000).toFixed(1)}s)`) : ''}`,
              tool_name: null,
              action: null,
              is_error: false,
              created_at: new Date().toISOString(),
            }].slice(-1000));
          } else if (se.type === 'agent_error' && se.agentId) {
            setLogs(prev => [...prev, {
              id: se.id || String(Date.now()) + Math.random(),
              project_id: projectId,
              agent_id: se.agentId,
              log_type: 'error' as const,
              level: 'error' as const,
              content: se.error || l('未知错误', 'Unknown error'),
              tool_name: null,
              action: null,
              is_error: true,
              created_at: new Date().toISOString(),
            }].slice(-1000));
          }
        }
      } catch {}
    };

    return () => es.close();
  }, [projectId, l, isZh]);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // 前端过滤
  const filteredLogs = logs.filter(log => {
    if (filterAgent !== 'all' && log.agent_id !== filterAgent) return false;
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    return true;
  });

  const toggleExpand = (id: string) => {
    setExpandedLog(prev => prev === id ? null : id);
  };

  const AGENT_NAMES: Record<string, { name: string; emoji: string }> = {
    engineer: { name: isZh ? '工程师' : 'Engineer', emoji: '👨‍💻' },
    architect: { name: isZh ? '架构师' : 'Architect', emoji: '🏗️' },
    game_designer: { name: isZh ? '游戏策划' : 'Game Designer', emoji: '🎮' },
    biz_designer: { name: isZh ? '商业策划' : 'Business Designer', emoji: '💼' },
    ceo: { name: 'CEO', emoji: '👔' },
  };

  const renderLog = (log: LogEntry) => {
    const agentInfo = AGENT_NAMES[log.agent_id];
    const agentLabel = `${agentInfo?.emoji} ${agentInfo?.name || log.agent_id}`;
    const timeStr = new Date(log.created_at).toLocaleTimeString(locale);
    const isExpanded = expandedLog === log.id;

    // system 日志
    if (log.log_type === 'system') {
      const levelCfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info;
      const longDetail = log.content && log.content.length > 200;
      return (
        <div
          key={log.id}
          className={`flex gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-800/50 transition-colors ${levelCfg.bg}`}
          onClick={() => longDetail && toggleExpand(log.id)}
        >
          <span className="text-gray-600 shrink-0 tabular-nums">{timeStr}</span>
          <span className={`${levelCfg.className} shrink-0 font-bold`}>{levelCfg.label}</span>
          <span className="text-purple-400 shrink-0">{agentLabel}</span>
          {log.action && <span className="text-gray-300 shrink-0">{log.action}</span>}
          {log.content && (
            <span className={`text-gray-500 ${longDetail ? '' : 'truncate'}`}>
              {isExpanded ? log.content : (longDetail ? log.content.slice(0, 200) + '...' : log.content)}
            </span>
          )}
          {longDetail && (
            <span className="text-gray-700 shrink-0">{isExpanded ? l('收起 ▲', 'Collapse ▲') : l('展开 ▼', 'Expand ▼')}</span>
          )}
        </div>
      );
    }

    // user_command（用户指令）
    if (log.log_type === 'user_command') {
      const isLong = log.content && log.content.length > 300;
      return (
        <div key={log.id} className="flex gap-2 px-2 py-0.5 bg-cyan-900/10 rounded">
          <span className="text-gray-600 shrink-0 tabular-nums">{timeStr}</span>
          <span className="text-cyan-400 shrink-0 font-bold">CMD </span>
          <span className="text-purple-400 shrink-0">{agentLabel}</span>
          <span className={`text-cyan-200 leading-relaxed whitespace-pre-wrap break-words ${isLong && !isExpanded ? 'line-clamp-4' : ''}`}>
            {isExpanded ? log.content : (isLong ? log.content.slice(0, 300) : log.content)}
          </span>
          {isLong && (
            <button onClick={() => toggleExpand(log.id)} className="text-cyan-500 hover:text-cyan-400 shrink-0 ml-1">
              {isExpanded ? l('收起', 'Collapse') : l('展开', 'Expand')}
            </button>
          )}
        </div>
      );
    }

    // text（MSG）
    if (log.log_type === 'text') {
      const isLong = log.content && log.content.length > 300;
      return (
        <div key={log.id} className="flex gap-2 px-2 py-0.5">
          <span className="text-gray-600 shrink-0 tabular-nums">{timeStr}</span>
          <span className="text-blue-400 shrink-0 font-bold">MSG </span>
          <span className="text-purple-400 shrink-0">{agentLabel}</span>
          <span className={`text-gray-300 leading-relaxed whitespace-pre-wrap break-words ${isLong && !isExpanded ? 'line-clamp-4' : ''}`}>
            {isExpanded ? log.content : (isLong ? log.content.slice(0, 300) : log.content)}
          </span>
          {isLong && (
            <button onClick={() => toggleExpand(log.id)} className="text-blue-500 hover:text-blue-400 shrink-0 ml-1">
              {isExpanded ? l('收起', 'Collapse') : l('展开', 'Expand')}
            </button>
          )}
        </div>
      );
    }

    // tool
    if (log.log_type === 'tool') {
      return (
        <div key={log.id} className="flex gap-2 px-2 py-1 bg-yellow-900/10 rounded">
          <span className="text-gray-600 shrink-0 tabular-nums">{timeStr}</span>
          <span className="text-yellow-400 shrink-0 font-bold">TOOL</span>
          <span className="text-purple-400 shrink-0">{agentLabel}</span>
          {log.tool_name && <span className="text-white font-semibold shrink-0">🔧 {log.tool_name}</span>}
          {log.content && (
            <span className={`text-gray-400 whitespace-pre-wrap break-all ${!isExpanded && log.content.length > 200 ? 'truncate' : ''}`}>
              {isExpanded ? log.content : log.content.slice(0, 200)}
              {!isExpanded && log.content.length > 200 && '...'}
            </span>
          )}
          {log.content && log.content.length > 200 && (
            <button onClick={() => toggleExpand(log.id)} className="text-yellow-500 hover:text-yellow-400 shrink-0 ml-1">
              {isExpanded ? l('收起', 'Collapse') : l('展开', 'Expand')}
            </button>
          )}
        </div>
      );
    }

    // tool_result
    if (log.log_type === 'tool_result') {
      return (
        <div key={log.id} className={`flex gap-2 px-2 py-1 rounded ${log.is_error ? 'bg-red-900/10' : 'bg-green-900/10'}`}>
          <span className="text-gray-600 shrink-0 tabular-nums">{timeStr}</span>
          <span className={`shrink-0 font-bold ${log.is_error ? 'text-red-400' : 'text-green-400'}`}>
            {log.is_error ? 'FAIL' : 'DONE'}
          </span>
          <span className="text-purple-400 shrink-0">{agentLabel}</span>
          <span className={`whitespace-pre-wrap break-all ${log.is_error ? 'text-red-300' : 'text-gray-400'} ${!isExpanded && log.content.length > 200 ? 'truncate' : ''}`}>
            {isExpanded ? log.content : log.content.slice(0, 200)}
            {!isExpanded && log.content.length > 200 && '...'}
          </span>
          {log.content.length > 200 && (
            <button onClick={() => toggleExpand(log.id)} className={`shrink-0 ml-1 ${log.is_error ? 'text-red-500' : 'text-green-500'}`}>
              {isExpanded ? l('收起', 'Collapse') : l('展开', 'Expand')}
            </button>
          )}
        </div>
      );
    }

    // done
    if (log.log_type === 'done') {
      return (
        <div key={log.id} className="flex gap-2 px-2 py-1 bg-green-900/5 rounded">
          <span className="text-gray-600 shrink-0 tabular-nums">{timeStr}</span>
          <span className="text-green-400 shrink-0 font-bold">DONE</span>
          <span className="text-purple-400 shrink-0">{agentLabel}</span>
          <span className="text-green-300">{log.content}</span>
        </div>
      );
    }

    // error
    if (log.log_type === 'error') {
      return (
        <div key={log.id} className="flex gap-2 px-2 py-1 bg-red-900/15 rounded">
          <span className="text-gray-600 shrink-0 tabular-nums">{timeStr}</span>
          <span className="text-red-400 shrink-0 font-bold">ERR!</span>
          <span className="text-purple-400 shrink-0">{agentLabel}</span>
          <span className="text-red-300">{log.content}</span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col h-[calc(100vh-160px)]">
      {/* 工具栏 */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 shrink-0">
        <span className="font-semibold text-gray-200 text-sm">{l('运行日志', 'Logs')}</span>

        <select
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none"
        >
          <option value="all">{l('全部 Agent', 'All Agents')}</option>
          {agents.map(a => (
            <option key={a.id} value={a.id}>{AGENT_NAMES[a.id]?.emoji} {a.name}</option>
          ))}
        </select>

        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none"
        >
          <option value="all">{l('全部级别', 'All Levels')}</option>
          <option value="success">{l('成功', 'Success')}</option>
          <option value="info">{l('信息', 'Info')}</option>
          <option value="warn">{l('警告', 'Warn')}</option>
          <option value="error">{l('错误', 'Error')}</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
            className="rounded border-gray-600"
          />
          {l('自动滚动', 'Auto Scroll')}
        </label>

        <button
          onClick={async () => {
            try {
              await api.deleteLogs(projectId);
              setLogs([]);
            } catch {}
          }}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-900/20"
          title={l('清除日志', 'Clear Logs')}
        >
          🗑️ {l('清除', 'Clear')}
        </button>

        <span className="text-xs text-gray-600">{filteredLogs.length} {l('条', 'items')}</span>
      </div>

      {/* 日志内容 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-0.5"
        onScroll={() => {
          const el = containerRef.current;
          if (el) {
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (distFromBottom > 50 && autoScroll) setAutoScroll(false);
            if (distFromBottom <= 10 && !autoScroll) setAutoScroll(true);
          }
        }}
      >
        {filteredLogs.map(log => renderLog(log))}

        {filteredLogs.length === 0 && (
          <div className="text-center text-gray-600 py-8">
            <div className="text-3xl mb-2">📜</div>
            {l('暂无日志，发送指令后将在此显示完整日志', 'No logs yet. Send a command to view logs here.')}
          </div>
        )}
      </div>
    </div>
  );
}
