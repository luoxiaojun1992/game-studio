import React, { useState, useRef, useEffect } from 'react';
import { Agent, AgentRole } from '../types';
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

export default function CommandPanel({ agents, onCommandSent }: Props) {
  const [selectedAgent, setSelectedAgent] = useState<AgentRole>('game_designer');
  const [message, setMessage] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamOutput, setStreamOutput] = useState<StreamLog[]>([]);
  const [model, setModel] = useState('claude-sonnet-4');
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamOutput]);

  const sendCommand = async () => {
    if (!message.trim() || streaming) return;

    const cmd = message;
    setMessage('');
    setStreaming(true);
    setStreamOutput([]);

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
              const time = new Date().toLocaleTimeString('zh-CN');

              if (event.type === 'text') {
                setStreamOutput(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.type === 'text') {
                    return [...prev.slice(0, -1), { ...last, content: (last.content || '') + event.content }];
                  }
                  return [...prev, { type: 'text', content: event.content, agentId: event.agentId, time }];
                });
              } else if (event.type === 'tool') {
                setStreamOutput(prev => [...prev, {
                  type: 'tool',
                  content: `🔧 ${event.name}`,
                  time
                }]);
              } else if (event.type === 'agent_done') {
                setStreamOutput(prev => [...prev, {
                  type: 'done',
                  content: `✅ 完成 (${event.duration ? Math.round(event.duration / 1000) + 's' : ''})`,
                  time
                }]);
              } else if (event.type === 'agent_error') {
                setStreamOutput(prev => [...prev, {
                  type: 'error',
                  content: `❌ 错误：${event.error}`,
                  time
                }]);
              } else if (event.type === 'command_started') {
                setStreamOutput(prev => [...prev, {
                  type: 'system',
                  content: `📡 指令已发送`,
                  time
                }]);
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setStreamOutput(prev => [...prev, {
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
              <option value="claude-sonnet-4">claude-sonnet-4</option>
              <option value="claude-opus-4">claude-opus-4</option>
            </select>
          </div>
        </div>

        {/* 流式输出区域 */}
        <div
          ref={outputRef}
          className="flex-1 bg-gray-950 rounded-xl border border-gray-800 font-mono text-xs p-4 overflow-y-auto space-y-1"
        >
          {streamOutput.length === 0 ? (
            <div className="text-gray-700 text-center py-8">
              <div className="text-3xl mb-2">⌨️</div>
              等待指令...
            </div>
          ) : (
            streamOutput.map((log, i) => (
              <div key={i} className={`flex gap-3 ${
                log.type === 'error' ? 'text-red-400' :
                log.type === 'done' ? 'text-green-400' :
                log.type === 'system' ? 'text-gray-500' :
                log.type === 'tool' ? 'text-yellow-400' :
                'text-gray-300'
              }`}>
                <span className="text-gray-700 shrink-0">{log.time}</span>
                <span className="leading-relaxed whitespace-pre-wrap break-words">{log.content}</span>
              </div>
            ))
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
