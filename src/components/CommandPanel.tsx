import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Agent, AgentRole, AgentMessage } from '../types';
import { api, API_BASE } from '../config';

interface Props {
  agents: Agent[];
  onCommandSent?: () => void;
}

interface StreamLog {
  type: string;
  content?: string;
  agentId?: string;
  time: string;
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

export default function CommandPanel({ agents, onCommandSent }: Props) {
  // 默认选中正在工作的 Agent，没有则选中第一个
  const workingAgent = agents.find(a => a.state?.status === 'working');
  const defaultAgent = workingAgent?.id || agents[0]?.id || 'game_designer';
  const [selectedAgent, setSelectedAgent] = useState<AgentRole>(defaultAgent);
  const [message, setMessage] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatHistory, setChatHistory] = useState<StreamLog[]>([]);
  const [currentStreamText, setCurrentStreamText] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState('glm-5.0');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [clearing, setClearing] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const streamTextIdRef = useRef(0);

  // 将历史消息转换为 StreamLog 格式
  const convertMessagesToStreamLogs = useCallback((msgs: AgentMessage[]): StreamLog[] => {
    const logs: StreamLog[] = [];
    for (const msg of msgs) {
      const time = new Date(msg.created_at).toLocaleTimeString('zh-CN');
      if (msg.role === 'user') {
        logs.push({ type: 'user', content: msg.content, agentId: msg.agent_id, time });
      } else if (msg.role === 'assistant') {
        // 解析工具调用
        let toolCalls: any[] = [];
        try {
          toolCalls = msg.tool_calls ? (typeof msg.tool_calls === 'string' ? JSON.parse(msg.tool_calls) : msg.tool_calls) : [];
        } catch {}
        
        if (toolCalls.length > 0) {
          // 先输出文本内容
          if (msg.content) {
            logs.push({ type: 'text', content: msg.content, agentId: msg.agent_id, time });
          }
          // 再输出工具调用摘要
          for (const tc of toolCalls) {
            logs.push({ type: 'tool', content: `🔧 ${tc.name} (${tc.status === 'completed' ? '完成' : tc.status === 'error' ? '失败' : '执行'})`, agentId: msg.agent_id, time });
          }
        } else {
          logs.push({ type: 'text', content: msg.content, agentId: msg.agent_id, time });
        }
        logs.push({ type: 'done', content: '✅ 完成', agentId: msg.agent_id, time });
      }
    }
    return logs;
  }, []);

  // 加载 Agent 历史消息
  const loadHistory = useCallback(async (agentId: AgentRole) => {
    setLoadingHistory(true);
    try {
      const data = await api.getAgentMessages(agentId);
      const messages: AgentMessage[] = data.messages || [];
      setChatHistory(convertMessagesToStreamLogs(messages));
    } catch {
      setChatHistory([]);
    }
    setLoadingHistory(false);
  }, [convertMessagesToStreamLogs]);

  // 动态获取可用模型列表
  useEffect(() => {
    api.getModels().then((res: any) => {
      if (res.models && res.models.length > 0) {
        setModels(res.models);
        const ids = res.models.map((m: any) => m.modelId || m.id || m.model);
        if (!ids.includes(model)) {
          setModel(ids[0]);
        }
      }
    }).catch(() => {
      setModels([
        { modelId: 'glm-5.0', name: 'glm-5.0' },
        { modelId: 'glm-5.0-turbo', name: 'glm-5.0-turbo' },
        { modelId: 'kimi-k2.5', name: 'kimi-k2.5' },
        { modelId: 'deepseek-v3-2-volc', name: 'deepseek-v3-2-volc' },
      ]);
    });
  }, []);

  // 当有 Agent 开始工作时，自动切换到该 Agent
  useEffect(() => {
    const working = agents.find(a => a.state?.status === 'working');
    if (working && working.id !== selectedAgent) {
      setSelectedAgent(working.id);
    }
  }, [agents, selectedAgent]);

  // 切换 Agent 时加载历史
  useEffect(() => {
    loadHistory(selectedAgent);
  }, [selectedAgent, loadHistory]);

  // 自动滚动
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [chatHistory, currentStreamText]);

  // 清除聊天记录
  const clearHistory = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await fetch(`${API_BASE}/api/agents/${selectedAgent}/messages`, { method: 'DELETE' });
      setChatHistory([]);
    } catch {}
    setClearing(false);
  };

  const sendCommand = async () => {
    if (!message.trim() || streaming) return;

    const cmd = message;
    const time = new Date().toLocaleTimeString('zh-CN');
    setMessage('');
    setStreaming(true);
    setCurrentStreamText('');

    // 添加用户消息到历史
    setChatHistory(prev => [...prev, { type: 'user', content: cmd, agentId: selectedAgent, time }]);

    try {
      const response = await fetch(`${API_BASE}/api/agents/${selectedAgent}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: cmd, model })
      });

      if (!response.body) {
        setStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              const eventTime = new Date().toLocaleTimeString('zh-CN');

              if (event.type === 'text') {
                fullText += event.content;
                setCurrentStreamText(fullText);
                streamTextIdRef.current += 1;
              } else if (event.type === 'tool') {
                // 工具调用时先把累积的文本加入历史
                if (fullText) {
                  setChatHistory(prev => [...prev, { type: 'text', content: fullText, agentId: event.agentId, time: eventTime }]);
                  fullText = '';
                  setCurrentStreamText('');
                }
                setChatHistory(prev => [...prev, {
                  type: 'tool',
                  content: `🔧 ${event.name}`,
                  time: eventTime
                }]);
              } else if (event.type === 'agent_done') {
                // 完成时把剩余文本加入历史
                if (fullText) {
                  setChatHistory(prev => [...prev, { type: 'text', content: fullText, agentId: event.agentId, time: eventTime }]);
                  setCurrentStreamText('');
                }
                setChatHistory(prev => [...prev, {
                  type: 'done',
                  content: `✅ 完成 (${event.duration ? Math.round(event.duration / 1000) + 's' : ''})`,
                  time: eventTime
                }]);
              } else if (event.type === 'agent_error') {
                if (fullText) {
                  setChatHistory(prev => [...prev, { type: 'text', content: fullText, agentId: event.agentId, time: eventTime }]);
                  setCurrentStreamText('');
                }
                setChatHistory(prev => [...prev, {
                  type: 'error',
                  content: `❌ 错误：${event.error}`,
                  time: eventTime
                }]);
              } else if (event.type === 'command_started') {
                // 无需额外处理，用户消息已在前面添加
              }
            } catch {}
          }
        }
      }

      // 确保剩余文本被保存
      if (fullText) {
        setChatHistory(prev => [...prev, { type: 'text', content: fullText, agentId: selectedAgent, time: new Date().toLocaleTimeString('zh-CN') }]);
        setCurrentStreamText('');
      }
    } catch (err: any) {
      setChatHistory(prev => [...prev, {
        type: 'error',
        content: `连接错误：${err.message}`,
        time: new Date().toLocaleTimeString('zh-CN')
      }]);
    } finally {
      setStreaming(false);
      onCommandSent?.();
    }
  };

  const currentAgent = AGENT_NAMES[selectedAgent];
  // 合并历史和当前流式文本
  const allLogs = [...chatHistory];

  return (
    <div className="flex gap-4 h-[calc(100vh-160px)]">
      {/* 左侧：Agent 选择 */}
      <div className="w-56 shrink-0 bg-gray-900 rounded-xl border border-gray-800 p-3">
        <div className="text-xs text-gray-500 font-medium mb-2 px-1">选择 Agent</div>
        <div className="space-y-1">
          {agents.map(agent => {
            const info = AGENT_NAMES[agent.id];
            const isSelected = agent.id === selectedAgent;
            const isPaused = agent.state?.isPaused;
            const isWorking = agent.state?.status === 'working';
            return (
              <button
                key={agent.id}
                onClick={() => setSelectedAgent(agent.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all border ${
                  isSelected
                    ? 'bg-blue-900/30 border-blue-600/50'
                    : 'border-transparent hover:bg-gray-800'
                }`}
              >
                <span className="text-lg">{agent.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 font-medium truncate">{agent.name}</div>
                  <div className="text-xs flex items-center gap-1">
                    {isPaused ? (
                      <span className="text-yellow-400">已暂停</span>
                    ) : isWorking ? (
                      <span className="text-green-400 flex items-center gap-1">
                        <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse inline-block" />
                        工作中
                      </span>
                    ) : (
                      <span className="text-gray-600">空闲</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* 清除记录按钮 */}
        <div className="mt-3 pt-3 border-t border-gray-800">
          <button
            onClick={clearHistory}
            disabled={clearing || chatHistory.length === 0}
            className="w-full text-xs text-gray-500 hover:text-red-400 disabled:text-gray-700 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-red-900/20"
          >
            🗑️ {clearing ? '清除中...' : '清除聊天记录'}
          </button>
        </div>
      </div>

      {/* 右侧：指令输入和输出 */}
      <div className="flex-1 flex flex-col gap-3">
        {/* 当前 Agent 信息 */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
          <span className="text-2xl">{currentAgent?.emoji}</span>
          <div>
            <div className="font-semibold text-white text-sm">向 {currentAgent?.name} 下达指令</div>
            <div className="text-xs text-gray-500">指令将以流式方式执行，结果实时显示</div>
          </div>
          <div className="ml-auto">
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
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
          className="flex-1 bg-gray-950 rounded-xl border border-gray-800 font-mono text-xs p-4 overflow-y-auto space-y-1.5"
        >
          {loadingHistory ? (
            <div className="text-gray-600 text-center py-8">
              <div className="text-2xl mb-2 animate-spin">⚙️</div>
              加载历史记录...
            </div>
          ) : allLogs.length === 0 && !currentStreamText ? (
            <div className="text-gray-700 text-center py-8">
              <div className="text-3xl mb-2">⌨️</div>
              等待指令...
            </div>
          ) : (
            allLogs.map((log, i) => (
              <div key={i} className={`flex gap-3 ${
                log.type === 'error' ? 'text-red-400' :
                log.type === 'done' ? 'text-green-500/60' :
                log.type === 'system' ? 'text-gray-500' :
                log.type === 'tool' ? 'text-yellow-400/80' :
                log.type === 'user' ? 'text-blue-300' :
                'text-gray-300'
              }`}>
                <span className="text-gray-700 shrink-0 tabular-nums">{log.time}</span>
                {log.type === 'user' && (
                  <span className="text-blue-500 shrink-0">YOU &gt;</span>
                )}
                <span className="leading-relaxed whitespace-pre-wrap break-words">{log.content}</span>
              </div>
            ))
          )}
          {/* 当前流式输出（实时显示） */}
          {currentStreamText && (
            <div className="flex gap-3 text-gray-300">
              <span className="text-gray-700 shrink-0 tabular-nums">{new Date().toLocaleTimeString('zh-CN')}</span>
              <span className="leading-relaxed whitespace-pre-wrap break-words">{currentStreamText}</span>
            </div>
          )}
          {streaming && (
            <div className="text-blue-400 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse inline-block" />
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
