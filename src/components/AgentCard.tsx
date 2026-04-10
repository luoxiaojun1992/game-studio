import React from 'react';
import { Agent, AgentRole, Handoff } from '../types';
import { useI18n } from '../i18n';

interface Props {
  agent: Agent;
   onPauseToggle?: () => void;
   onSendCommand?: () => void;
   disableActions?: boolean;
  streamLog?: { agentId: AgentRole; content: string; time: string };
  pendingHandoffs?: Handoff[];
  activeHandoffs?: Handoff[];
}

const STATUS_CONFIG = {
  idle: { label: '空闲', color: 'text-gray-400', dot: 'bg-gray-500', bg: 'border-gray-700' },
  working: { label: '工作中', color: 'text-green-400', dot: 'bg-green-400', bg: 'border-green-800/50' },
  paused: { label: '已暂停', color: 'text-yellow-400', dot: 'bg-yellow-400', bg: 'border-yellow-800/50' },
  error: { label: '出错', color: 'text-red-400', dot: 'bg-red-400', bg: 'border-red-800/50' },
};

const AGENT_NAMES_ZH: Record<string, string> = {
  engineer: '软件工程师',
  architect: '架构师',
  game_designer: '游戏策划',
  biz_designer: '商业策划',
  ceo: 'CEO',
  team_builder: '团队建设',
};

const AGENT_NAMES_EN: Record<string, string> = {
  engineer: 'Engineer',
  architect: 'Architect',
  game_designer: 'Game Designer',
  biz_designer: 'Business Designer',
  ceo: 'CEO',
  team_builder: 'Team Building',
};

const AGENT_TITLES_ZH: Record<string, string> = {
  engineer: '负责技术实现和代码开发',
  architect: '负责整体架构设计和技术评审',
  game_designer: '负责游戏玩法设计和策划案',
  biz_designer: '负责商业模式和运营策略',
  ceo: '负责产品决策和团队协调',
  team_builder: '负责团队信息总结与高价值记忆沉淀',
};

const AGENT_TITLES_EN: Record<string, string> = {
  engineer: 'Technical implementation and development',
  architect: 'Architecture design and technical review',
  game_designer: 'Game design and proposal creation',
  biz_designer: 'Business model and operations strategy',
  ceo: 'Product decisions and team coordination',
  team_builder: 'Team information synthesis and high-value memory curation',
};
const RESPONSIBILITIES_MAP: Record<string, string> = {
  // Engineer
  '技术方案设计与评估': 'Technical solution design & evaluation',
  '游戏功能开发实现': 'Game feature development',
  '代码编写与软件测试': 'Code writing & software testing',
  '技术问题排查': 'Technical troubleshooting',
  '交付可运行的游戏成品': 'Deliver playable game products',
  // Architect
  '整体技术架构设计': 'Overall technical architecture design',
  '技术选型决策': 'Technology stack decisions',
  '代码质量评审': 'Code quality review',
  '性能优化指导': 'Performance optimization guidance',
  '技术规范制定': 'Technical standards formulation',
  // Game Designer
  '游戏概念设计': 'Game concept design',
  '游戏玩法规则设计': 'Gameplay & rules design',
  '关卡和内容设计': 'Level & content design',
  'UI 设计与用户体验设计': 'UI & UX design',
  '游戏数值平衡': 'Game balance & tuning',
  // Business Designer
  '商业模式设计': 'Business model design',
  '盈利方案规划': 'Monetization planning',
  '市场分析': 'Market analysis',
  '定价策略': 'Pricing strategy',
  '运营策略': 'Operations strategy',
  // CEO
  '策划案综合评审': 'Proposal comprehensive review',
  '商业决策审批': 'Business decision approval',
  '团队协调管理': 'Team coordination & management',
  '产品方向把控': 'Product direction control',
  '最终方案决策': 'Final decision making',
  // Team Builder
  '汇总项目最新提案、任务、交接、日志、记忆': 'Aggregate latest proposals, tasks, handoffs, logs and memories',
  '提炼可复用的高价值经验与决策': 'Extract reusable high-value insights and decisions',
  '将高价值结论沉淀为长期记忆': 'Persist high-value conclusions into long-term memory',
  '输出团队协作改进建议': 'Provide team collaboration improvement suggestions',
};
const NOOP = () => {};

export default function AgentCard({ agent, onPauseToggle, onSendCommand, disableActions = false, streamLog, pendingHandoffs = [], activeHandoffs = [] }: Props) {
  const { l, isZh } = useI18n();
  const status = agent.state?.status || 'idle';
  const statusCfg = {
    idle: { ...STATUS_CONFIG.idle, label: l('空闲', 'Idle') },
    working: { ...STATUS_CONFIG.working, label: l('工作中', 'Working') },
    paused: { ...STATUS_CONFIG.paused, label: l('已暂停', 'Paused') },
    error: { ...STATUS_CONFIG.error, label: l('出错', 'Error') },
  }[status];
  const isPaused = agent.state?.isPaused;

  const incomingPending = pendingHandoffs.filter(h => h.to_agent_id === agent.id);
  const outgoingActive = activeHandoffs.filter(h => h.from_agent_id === agent.id && ['pending', 'accepted', 'working'].includes(h.status));
  const hasHandoffActivity = incomingPending.length > 0 || outgoingActive.length > 0;

  return (
    <div
      className={`bg-gray-900 rounded-xl border ${statusCfg.bg} p-4 flex flex-col gap-3 transition-all hover:border-opacity-80`}
      style={{ borderTopColor: agent.color, borderTopWidth: 3 }}
    >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{agent.emoji}</span>
            <div>
              <div className="font-semibold text-white text-sm">{(isZh ? AGENT_NAMES_ZH : AGENT_NAMES_EN)[agent.id] || agent.name}</div>
              <div className="text-xs text-gray-500">{(isZh ? AGENT_TITLES_ZH : AGENT_TITLES_EN)[agent.id] || agent.title}</div>
            </div>
          </div>

        
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusCfg.dot} ${status === 'working' ? 'animate-pulse' : ''}`} />
          <span className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</span>
          {incomingPending.length > 0 && (
            <span className="bg-purple-500/20 text-purple-300 border border-purple-500/40 text-xs px-1.5 py-0 rounded-full font-bold" title={`${incomingPending.length} ${l('个待接收交接', 'pending handoffs')}`}>
              📥 {incomingPending.length}
            </span>
          )}
          {outgoingActive.length > 0 && (
            <span className="bg-green-500/20 text-green-300 border border-green-500/40 text-xs px-1.5 py-0 rounded-full font-bold" title={`${outgoingActive.length} ${l('个已发出交接', 'outgoing handoffs')}`}>
              📤 {outgoingActive.length}
            </span>
          )}
        </div>
      </div>

      
      <div className="min-h-[40px]">
        {agent.state?.currentTask ? (
          <div className="text-xs text-gray-400 bg-gray-800 rounded-lg p-2 leading-relaxed">
            <span className="text-gray-500">{l('任务', 'Task')}:</span>
            <span className="text-gray-300">{agent.state.currentTask.slice(0, 80)}
              {agent.state.currentTask.length > 80 ? '...' : ''}
            </span>
          </div>
        ) : streamLog ? (
          <div className="text-xs text-gray-500 bg-gray-800/50 rounded-lg p-2 leading-relaxed font-mono">
            {streamLog.content.slice(-80)}
          </div>
        ) : (
          <div className="text-xs text-gray-600 italic">{l('等待任务...', 'Waiting for tasks...')}</div>
        )}
      </div>

      
      <div className="space-y-1">
        {agent.responsibilities?.slice(0, 2).map((r, i) => (
          <div key={i} className="text-xs text-gray-500 flex items-start gap-1">
            <span className="text-gray-600 shrink-0 mt-0.5">•</span>
            <span className="truncate">{isZh ? r : (RESPONSIBILITIES_MAP[r] || r)}</span>
          </div>
        ))}
      </div>

      
      {!disableActions && (
        <div className="flex gap-2 mt-auto pt-2 border-t border-gray-800">
          <button
            onClick={onSendCommand || NOOP}
            className="flex-1 text-xs bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/40 text-blue-300 rounded-lg py-1.5 transition-all"
          >
            {l('下达指令', 'Send Command')}
          </button>
          <button
            onClick={onPauseToggle || NOOP}
            className={`flex-1 text-xs rounded-lg py-1.5 border transition-all ${
              isPaused
                ? 'bg-green-600/20 hover:bg-green-600/40 border-green-600/40 text-green-300'
                : 'bg-yellow-600/20 hover:bg-yellow-600/40 border-yellow-600/40 text-yellow-300'
            }`}
          >
            {isPaused ? l('▶ 恢复', '▶ Resume') : l('⏸ 暂停', '⏸ Pause')}
          </button>
        </div>
      )}
    </div>
  );
}
