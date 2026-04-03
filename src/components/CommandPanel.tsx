import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Agent, AgentRole, LogEntry } from '../types';
import { api, API_BASE } from '../config';

interface Props {
  agents: Agent[];
  logs: LogEntry[];
  projectId: string;
  selectedAgentId?: AgentRole;
  onCommandSent?: () => void;
  model: string;
  onModelChange: (model: string) => void;
}

const AGENT_NAMES: Record<string, { name: string; emoji: string; color: string }> = {
  engineer: { name: '软件工程师', emoji: '👨‍💻', color: '#0052D9' },
  architect: { name: '架构师', emoji: '🏗️', color: '#00A870' },
  game_designer: { name: '游戏策划', emoji: '🎮', color: '#9B30FF' },
  biz_designer: { name: '商业策划', emoji: '💼', color: '#E37318' },
  ceo: { name: 'CEO', emoji: '👔', color: '#C9353F' },
};

interface ModelInfo {
  modelId?: string;
  id?: string;
  model?: string;
  name?: string;
  description?: string;
}

const STORAGE_KEY = 'commandPanel_lastAgent';

export default function CommandPanel({ agents, logs, projectId, selectedAgentId, onCommandSent, model, onModelChange }: Props) {
  // 从 localStorage 读取上次选择的 Agent，或使用默认值
  const getInitialAgent = (): AgentRole => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && agents.find(a => a.id === saved)) {
      return saved as AgentRole;
    }
    const workingAgent = agents.find(a => a.state?.status === 'working');
    return workingAgent?.id || agents[0]?.id || 'game_designer';
  };

  const [selectedAgent, setSelectedAgent] = useState<AgentRole>(getInitialAgent);
  const [message, setMessage] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [currentStreamText, setCurrentStreamText] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [clearing, setClearing] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const prevSelectedAgentIdRef = useRef<AgentRole | undefined>(selectedAgentId);

  // 从 logs 取当前 Agent 的最新 1000 条记录
  const agentLogs = useMemo((): LogEntry[] => {
    return logs
      .filter(l => l.agent_id === selectedAgent)
      .slice(-1000);
  }, [logs, selectedAgent]);

  // 动态获取可用模型列表
  useEffect(() => {
    api.getModels().then((res: any) => {
      if (res.models && res.models.length > 0) {
        setModels(res.models);
        const ids = res.models.map((m: any) => m.modelId || m.id || m.model);
        if (!ids.includes(model)) {
          onModelChange(ids[0]);
        }
      }
    }).catch(() => {
      const fallback = [
        { modelId: 'glm-5.0', name: 'glm-5.0' },
        { modelId: 'glm-5.0-turbo', name: 'glm-5.0-turbo' },
        { modelId: 'kimi-k2.5', name: 'kimi-k2.5' },
        { modelId: 'deepseek-v3-2-volc', name: 'deepseek-v3-2-volc' },
      ];
      setModels(fallback);
      const ids = fallback.map((m: any) => m.modelId || m.id || m.model);
      if (!ids.includes(model)) {
        onModelChange(ids[0]);
      }
    });
  }, [model, onModelChange]);

  // 外部指定目标 Agent（从团队总览点击跳转）
  // 当 selectedAgentId 变化时，总是切换到该 Agent（即使和当前选中相同，也确保同步）
  useEffect(() => {
    if (selectedAgentId) {
      prevSelectedAgentIdRef.current = selectedAgentId;
      if (selectedAgentId !== selectedAgent) {
        setSelectedAgent(selectedAgentId);
      }
      localStorage.setItem(STORAGE_KEY, selectedAgentId);
    }
  }, [selectedAgentId]);

  // 在指令中心内切换 Agent 时，记住选择
  const handleAgentChange = (agentId: AgentRole) => {
    setSelectedAgent(agentId);
    localStorage.setItem(STORAGE_KEY, agentId);
  };

  // 切换 Agent 时清空流式文本
  useEffect(() => {
    setCurrentStreamText('');
  }, [selectedAgent]);

  // 自动滚动到底部（最新日志），与运行日志逻辑一致
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [agentLogs, currentStreamText, autoScroll]);

  // 清除聊天记录
  const clearHistory = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await fetch(`${API_BASE}/api/projects/${projectId}/logs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {}
    setClearing(false);
  };

  const toggleExpand = (id: string) => {
    setExpandedLog(prev => prev === id ? null : id);
  };

  const sendCommand = async () => {
    if (!message.trim() || streaming) return;
    setMessage('');
    setStreaming(true);
    setCurrentStreamText('');

    try {
      const res = await fetch(`${API_BASE}/api/agents/${selectedAgent}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), model, projectId })
      });
      if (!res.body) { setStreaming(false); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const e = JSON.parse(line.slice(6));
              if (e.type === 'text') {
                fullText += e.content;
                setCurrentStreamText(fullText);
              }
            } catch {}
          }
        }
      }
      setCurrentStreamText('');
    } catch {}
    setStreaming(false);
    onCommandSent?.();
  };

  const currentAgent = AGENT_NAMES[selectedAgent];
  const hasContent = agentLogs.length > 0 || currentStreamText;

  // 渲染单条日志，与运行日志格式一致
  const renderLog = (log: LogEntry) => {
    const agentInfo = AGENT_NAMES[log.agent_id];
    const agentLabel = `${agentInfo?.emoji} ${agentInfo?.name || log.agent_id}`;
    const timeStr = new Date(log.created_at).toLocaleTimeString('zh-CN');
    const isExpanded = expandedLog === log.id;

    // user_command（用户指令）- 青色背景
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
              {isExpanded ? '收起' : '展开'}
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
              {isExpanded ? '收起' : '展开'}
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
              {isExpanded ? '收起' : '展开'}
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
              {isExpanded ? '收起' : '展开'}
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

    // system 或其他类型
    return (
      <div key={log.id} className="flex gap-2 px-2 py-0.5">
        <span className="text-gray-600 shrink-0 tabular-nums">{timeStr}</span>
        <span className="text-blue-400 shrink-0 font-bold">INFO</span>
        <span className="text-purple-400 shrink-0">{agentLabel}</span>
        {log.action && <span className="text-gray-300 shrink-0">{log.action}</span>}
        <span className="text-gray-500">{log.content}</span>
      </div>
    );
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-160px)]">
      {/* 左侧：Agent 选择 */}
      <div className="w-56 shrink-0 bg-gray-900 rounded-xl border border-gray-800 p-3">
        <div className="text-xs text-gray-500 font-medium mb-2 px-1">选择 Agent</div>
        <div className="space-y-1">
          {agents.map(agent => {
            const isSelected = agent.id === selectedAgent;
            return (
              <button
                key={agent.id}
                onClick={() => handleAgentChange(agent.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all border ${
                  isSelected ? 'bg-blue-900/30 border-blue-600/50' : 'border-transparent hover:bg-gray-800'
                }`}
              >
                <span className="text-lg">{agent.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 font-medium truncate">{agent.name}</div>
                  <div className="text-xs">
                    {agent.state?.status === 'working' ? (
                      <span className="text-green-400 flex items-center gap-1">
                        <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse" />工作中
                      </span>
                    ) : agent.state?.isPaused ? (
                      <span className="text-yellow-400">已暂停</span>
                    ) : (
                      <span className="text-gray-600">空闲</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 pt-3 border-t border-gray-800">
          <button
            onClick={clearHistory}
            disabled={clearing || agentLogs.length === 0}
            className="w-full text-xs text-gray-500 hover:text-red-400 disabled:text-gray-700 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-red-900/20"
          >
            🗑️ {clearing ? '清除中...' : '清除聊天记录'}
          </button>
        </div>
      </div>

      {/* 右侧：指令输入和输出 */}
      <div className="flex-1 flex flex-col gap-3">
        {/* 当前 Agent 信息 + 自动滚动开关 */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
          <span className="text-2xl">{currentAgent?.emoji}</span>
          <div>
            <div className="font-semibold text-white text-sm">向 {currentAgent?.name} 下达指令</div>
            <div className="text-xs text-gray-500">指令将以流式方式执行，结果实时显示</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="rounded border-gray-600"
              />
              自动滚动
            </label>
            <select
              value={model}
              onChange={e => onModelChange(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none"
            >
              {models.length > 0 ? models.map(m => {
                const id = m.modelId || (m as any).model || (m as any).id;
                const label = m.name || id;
                return (
                  <option key={id} value={id}>{label}{id === models[0]?.modelId || id === models[0]?.id || id === models[0]?.model ? '（推荐）' : ''}</option>
                );
              }) : (
                <option value="glm-5.0">glm-5.0</option>
              )}
            </select>
          </div>
        </div>

        {/* 聊天输出区域 */}
        <div 
          ref={outputRef} 
          className="flex-1 bg-gray-950 rounded-xl border border-gray-800 font-mono text-xs p-2 overflow-y-auto space-y-0.5"
          onScroll={() => {
            const el = outputRef.current;
            if (el) {
              const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              if (distFromBottom > 50 && autoScroll) setAutoScroll(false);
              if (distFromBottom <= 10 && !autoScroll) setAutoScroll(true);
            }
          }}
        >
          {!hasContent ? (
            <div className="text-gray-700 text-center py-8">
              <div className="text-3xl mb-2">⌨️</div>等待指令...
            </div>
          ) : (
            agentLogs.map(log => renderLog(log))
          )}
          {currentStreamText && (
            <div className="flex gap-2 px-2 py-0.5">
              <span className="text-gray-600 shrink-0 tabular-nums">{new Date().toLocaleTimeString('zh-CN')}</span>
              <span className="text-blue-400 shrink-0 font-bold">MSG </span>
              <span className="text-purple-400 shrink-0">{currentAgent?.emoji} {currentAgent?.name}</span>
              <span className="text-gray-300 whitespace-pre-wrap break-words">{currentStreamText}</span>
            </div>
          )}
          {streaming && (
            <div className="text-blue-400 flex items-center gap-2 px-2 py-1">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              Agent 正在处理...
            </div>
          )}
        </div>

        {/* 指令输入 */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 shrink-0">
          <div className="flex gap-3">
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendCommand();
                }
              }}
              placeholder={`向 ${currentAgent?.name} 下达指令... (Enter 发送，Shift+Enter 换行)`}
              rows={3}
              disabled={streaming}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600 resize-none disabled:opacity-50"
            />
            <button
              onClick={sendCommand}
              disabled={!message.trim() || streaming}
              className="px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              {streaming ? '执行中...' : '发送'}
            </button>
          </div>

          {/* 快捷指令 */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {getQuickCommands(selectedAgent).map((cmd, i) => (
              <button
                key={i}
                onClick={() => setMessage(cmd)}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded-full px-2.5 py-1 border border-gray-700 transition-all"
              >
                {cmd.length > 30 ? cmd.slice(0, 30) + '...' : cmd}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function getQuickCommands(agentId: AgentRole): string[] {
  const cmds: Record<AgentRole, string[]> = {
    game_designer: [
      '请为一款休闲手机游戏制作完整策划案',
      '设计一个2048风格的数字消除游戏',
      '为贪吃蛇游戏制作策划案',
    ],
    biz_designer: [
      '为休闲游戏设计商业模式',
      '分析竞品并制定盈利方案',
      '制定游戏上线运营计划',
    ],
    ceo: [
      '评审最新的游戏策划案',
      '综合评审游戏和商业方案',
      '给出产品方向建议',
    ],
    architect: [
      '设计游戏的技术架构方案',
      '评审软件工程师的技术方案',
      '制定编码规范',
    ],
    engineer: [
      '根据策划案开发一个贪吃蛇游戏（单文件HTML）',
      '开发一个2048数字消除游戏',
      '为已有游戏编写测试方案',
    ],
  };
  return cmds[agentId] || [];
}
