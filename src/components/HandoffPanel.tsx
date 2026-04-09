import React, { useState, useEffect } from 'react';
import { Agent, AgentRole, Handoff, HandoffStatus, HandoffPriority } from '../types';
import { api, API_BASE } from '../config';
import { useI18n } from '../i18n';

interface Props {
  agents: Agent[];
  projectId: string;
}

const STATUS_CONFIG: Record<HandoffStatus, { label: string; color: string; bg: string; icon: string }> = {
  pending: { label: '待接收', color: 'text-yellow-300', bg: 'bg-yellow-500/20 border-yellow-600/40', icon: '📥' },
  accepted: { label: '已接收', color: 'text-blue-300', bg: 'bg-blue-500/20 border-blue-600/40', icon: '📥' },
  working: { label: '处理中', color: 'text-green-300', bg: 'bg-green-500/20 border-green-600/40', icon: '⚡' },
  completed: { label: '已完成', color: 'text-emerald-300', bg: 'bg-emerald-500/20 border-emerald-600/40', icon: '✅' },
  rejected: { label: '已拒绝', color: 'text-red-300', bg: 'bg-red-500/20 border-red-600/40', icon: '❌' },
  cancelled: { label: '已取消', color: 'text-gray-400', bg: 'bg-gray-500/20 border-gray-600/40', icon: '🚫' },
};

const PRIORITY_CONFIG: Record<HandoffPriority, { label: string; color: string }> = {
  low: { label: '低', color: 'text-gray-400' },
  normal: { label: '普通', color: 'text-blue-400' },
  high: { label: '高', color: 'text-orange-400' },
  urgent: { label: '紧急', color: 'text-red-400' },
};

const AGENT_EMOJI: Record<string, string> = {
  engineer: '👨‍💻', architect: '🏗️', game_designer: '🎮',
  biz_designer: '💼', ceo: '👔',
};

const AGENT_NAMES_ZH: Record<string, string> = {
  engineer: '软件工程师',
  architect: '架构师',
  game_designer: '游戏策划',
  biz_designer: '商业策划',
  ceo: 'CEO',
};

const AGENT_NAMES_EN: Record<string, string> = {
  engineer: 'Engineer',
  architect: 'Architect',
  game_designer: 'Game Designer',
  biz_designer: 'Business Designer',
  ceo: 'CEO',
};

function getAgentName(agents: Agent[], agentId: string, isZh: boolean): string {
  const agent = agents.find(a => a.id === agentId);
  const nameMap = isZh ? AGENT_NAMES_ZH : AGENT_NAMES_EN;
  return nameMap[agentId] || (agent ? agent.name : agentId);
}

export default function HandoffPanel({ agents, projectId }: Props) {
  const { l, locale, isZh } = useI18n();
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<HandoffStatus | 'all'>('all');
  const [formFrom, setFormFrom] = useState<AgentRole>('game_designer');
  const [formTo, setFormTo] = useState<AgentRole>('architect');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formContext, setFormContext] = useState('');
  const [formPriority, setFormPriority] = useState<HandoffPriority>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const loadHandoffs = async () => {
    try {
      const data = await api.getHandoffs(projectId);
      if (Array.isArray(data)) {
        setHandoffs(data);
      } else if (data.handoffs) {
        setHandoffs(data.handoffs);
      }
    } catch {}
  };

  useEffect(() => {
    loadHandoffs();
  }, [projectId]);

  const handleCreateHandoff = async () => {
    if (!formTitle.trim() || !formDesc.trim()) return;
    setSubmitting(true);
    try {
      await api.createHandoff({
        project_id: projectId,
        from_agent_id: formFrom,
        to_agent_id: formTo,
        title: formTitle.trim(),
        description: formDesc.trim(),
        context: formContext.trim() || undefined,
        priority: formPriority,
      });
      setShowCreateDialog(false);
      setFormTitle('');
      setFormDesc('');
      setFormContext('');
      setFormPriority('normal');
      loadHandoffs();
    } catch (e) {
      console.error('创建交接失败:', e);
    }
    setSubmitting(false);
  };

  const handleAccept = async (id: string) => {
    await api.acceptHandoff(id);
    loadHandoffs();
  };

  const handleConfirm = async (id: string) => {
    setConfirmingId(id);
    try {
      await fetch(`${API_BASE}/api/handoffs/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId })
      }).then(r => r.json());
      loadHandoffs();
    } catch (e) {
      console.error('确认交接失败:', e);
    }
    setConfirmingId(null);
  };

  const handleComplete = async (id: string) => {
    await api.completeHandoff(id);
    loadHandoffs();
  };

  const handleReject = async (id: string) => {
    await api.rejectHandoff(id);
    loadHandoffs();
  };

  const handleCancel = async (id: string) => {
    await api.cancelHandoff(id);
    loadHandoffs();
  };
  const quickHandoffs = [
    { from: 'game_designer' as AgentRole, to: 'ceo' as AgentRole, title: l('游戏策划案评审', 'Game Design Review'), desc: l('请评审最新的游戏策划案，确认游戏概念和玩法设计的可行性。', 'Please review the latest game design proposal and verify concept/playability feasibility.') },
    { from: 'ceo' as AgentRole, to: 'architect' as AgentRole, title: l('技术架构设计', 'Architecture Design'), desc: l('策划案已通过，请基于策划案设计技术架构方案。', 'The design proposal is approved, please prepare the technical architecture plan.') },
    { from: 'architect' as AgentRole, to: 'engineer' as AgentRole, title: l('技术开发任务', 'Development Task'), desc: l('技术方案已确定，请按照方案进行游戏开发实现。', 'The technical plan is finalized, please implement the game accordingly.') },
    { from: 'game_designer' as AgentRole, to: 'biz_designer' as AgentRole, title: l('商业策划需求', 'Business Planning Request'), desc: l('游戏策划案已完成，请基于策划案设计商业模式。', 'The game design is ready, please design the business model based on it.') },
    { from: 'engineer' as AgentRole, to: 'game_designer' as AgentRole, title: l('开发完成确认', 'Development Completion Review'), desc: l('游戏开发已完成，请确认是否符合策划要求。', 'Game development is complete, please verify it meets design requirements.') },
  ];

  const handleQuickHandoff = async (quick: typeof quickHandoffs[0]) => {
    setFormFrom(quick.from);
    setFormTo(quick.to);
    setFormTitle(quick.title);
    setFormDesc(quick.desc);
    setFormContext('');
    setFormPriority('normal');
    setShowCreateDialog(true);
  };

  const filteredHandoffs = filterStatus === 'all'
    ? handoffs
    : handoffs.filter(h => h.status === filterStatus);

  const pendingCount = handoffs.filter(h => h.status === 'pending').length;
  const activeCount = handoffs.filter(h => ['pending', 'accepted', 'working'].includes(h.status)).length;
  const buildPipeline = () => {
    const steps: { agent: AgentRole; incoming: Handoff[]; outgoing: Handoff[] }[] = [];
    const order: AgentRole[] = ['game_designer', 'ceo', 'architect', 'engineer', 'biz_designer'];
    for (const agentId of order) {
      const agent = agents.find(a => a.id === agentId);
      if (!agent) continue;
      const incoming = handoffs.filter(h => h.to_agent_id === agentId && ['pending', 'accepted', 'working'].includes(h.status));
      const outgoing = handoffs.filter(h => h.from_agent_id === agentId && ['pending', 'accepted', 'working'].includes(h.status));
      steps.push({ agent: agentId, incoming, outgoing });
    }
    return steps;
  };

  const pipeline = buildPipeline();
  const statusTabs: { key: HandoffStatus | 'all'; label: string }[] = [
    { key: 'all', label: l('全部', 'All') },
    { key: 'pending', label: l('待接收', 'Pending') },
    { key: 'accepted', label: l('已接收', 'Accepted') },
    { key: 'working', label: l('处理中', 'Working') },
    { key: 'completed', label: l('已完成', 'Completed') },
    { key: 'rejected', label: l('已拒绝', 'Rejected') },
    { key: 'cancelled', label: l('已取消', 'Cancelled') },
  ];

  return (
    <div className="h-full flex flex-col">
      
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">🔄 {l('任务交接', 'Handoffs')}</h2>
          {pendingCount > 0 && (
            <span className="bg-yellow-500/20 text-yellow-300 border border-yellow-600/40 text-xs px-2 py-0.5 rounded-full">
              {pendingCount} {l('个待接收', 'pending')}
            </span>
          )}
          {activeCount > 0 && (
            <span className="bg-green-500/20 text-green-300 border border-green-600/40 text-xs px-2 py-0.5 rounded-full">
              {activeCount} {l('个活跃中', 'active')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {l('+ 新建交接', '+ New Handoff')}
          </button>
        </div>
      </div>

      
      <div className="shrink-0 bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">📋 {l('交接流水线', 'Handoff Pipeline')}</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {pipeline.map((step, i) => (
            <React.Fragment key={step.agent}>
              {i > 0 && (
                <div className="shrink-0 flex flex-col items-center gap-0.5">
                  {pipeline[i - 1].outgoing.some(h => h.to_agent_id === step.agent) ? (
                    <div className="text-green-400 text-lg">→</div>
                  ) : (
                    <div className="text-gray-700 text-lg">→</div>
                  )}
                </div>
              )}
              <div className={`shrink-0 rounded-lg border p-2.5 min-w-[120px] transition-all ${
                step.incoming.length > 0 || step.outgoing.length > 0
                  ? 'border-blue-600/50 bg-blue-600/10'
                  : 'border-gray-700 bg-gray-800/50'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{AGENT_EMOJI[step.agent]}</span>
                  <span className="text-xs font-medium text-white truncate">{getAgentName(agents, step.agent, isZh)}</span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {step.incoming.length > 0 && (
                    <span className="bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded">
                      ← {step.incoming.length}
                    </span>
                  )}
                  {step.outgoing.length > 0 && (
                    <span className="bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded">
                      → {step.outgoing.length}
                    </span>
                  )}
                  {step.incoming.length === 0 && step.outgoing.length === 0 && (
                    <span className="text-gray-600">{l('空闲', 'Idle')}</span>
                  )}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      
      <div className="shrink-0 bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">⚡ {l('快捷交接', 'Quick Handoffs')}</h3>
        <div className="flex flex-wrap gap-2">
          {quickHandoffs.map((quick, i) => (
            <button
              key={i}
              onClick={() => handleQuickHandoff(quick)}
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all"
            >
              <span>{AGENT_EMOJI[quick.from]}</span>
              <span className="text-gray-500">→</span>
              <span>{AGENT_EMOJI[quick.to]}</span>
              <span>{quick.title}</span>
            </button>
          ))}
        </div>
      </div>

      
      <div className="shrink-0 flex items-center gap-1.5 mb-3">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilterStatus(tab.key)}
            className={`text-xs px-3 py-1 rounded-lg transition-all ${
              filterStatus === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      
      <div className="flex-1 overflow-y-auto space-y-2">
        {filteredHandoffs.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-600">
            <div className="text-center">
              <div className="text-4xl mb-2">🔄</div>
              <p className="text-sm">{l('暂无交接记录', 'No handoffs yet')}</p>
              <p className="text-xs mt-1">{l('点击「新建交接」或使用快捷交接开始', 'Click \"New Handoff\" or use quick handoffs')}</p>
            </div>
          </div>
        ) : (
          filteredHandoffs.map(handoff => {
            const statusCfg = {
              ...STATUS_CONFIG[handoff.status],
              label: ({
                pending: l('待接收', 'Pending'),
                accepted: l('已接收', 'Accepted'),
                working: l('处理中', 'Working'),
                completed: l('已完成', 'Completed'),
                rejected: l('已拒绝', 'Rejected'),
                cancelled: l('已取消', 'Cancelled'),
              } as Record<HandoffStatus, string>)[handoff.status]
            };
            const priorityCfg = {
              ...PRIORITY_CONFIG[handoff.priority],
              label: ({
                low: l('低', 'Low'),
                normal: l('普通', 'Normal'),
                high: l('高', 'High'),
                urgent: l('紧急', 'Urgent'),
              } as Record<HandoffPriority, string>)[handoff.priority]
            };
            const isExpanded = expandedId === handoff.id;

            return (
              <div
                key={handoff.id}
                className={`bg-gray-900 rounded-xl border transition-all ${
                  handoff.status === 'pending' ? 'border-yellow-800/50' :
                  handoff.status === 'completed' ? 'border-emerald-800/30' :
                  handoff.status === 'rejected' ? 'border-red-800/30' :
                  'border-gray-800'
                }`}
              >
                
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800/30"
                  onClick={() => setExpandedId(isExpanded ? null : handoff.id)}
                >
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-lg">{AGENT_EMOJI[handoff.from_agent_id]}</span>
                    <span className="text-gray-500 text-xs">→</span>
                    <span className="text-lg">{AGENT_EMOJI[handoff.to_agent_id]}</span>
                  </div>

                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{handoff.title}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterStatus(handoff.status);
                        }}
                        className={`text-xs px-1.5 py-0.5 rounded border shrink-0 transition-all hover:brightness-110 ${statusCfg.bg} ${statusCfg.color}`}
                      >
                        {statusCfg.icon} {statusCfg.label}
                      </button>
                      {handoff.priority !== 'normal' && (
                        <span className={`text-xs shrink-0 ${priorityCfg.color}`}>
                          {priorityCfg.label}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {getAgentName(agents, handoff.from_agent_id, isZh)} → {getAgentName(agents, handoff.to_agent_id, isZh)}
                      <span className="mx-2">·</span>
                      {new Date(handoff.created_at).toLocaleString(locale)}
                    </div>
                  </div>

                  
                  <span className={`text-gray-500 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                </div>

                
                {isExpanded && (
                  <div className="border-t border-gray-800 px-4 py-3 space-y-3">
                    
                    <div>
                      <div className="text-xs text-gray-500 mb-1 font-medium">{l('任务描述', 'Task Description')}</div>
                      <div className="text-sm text-gray-300 bg-gray-800/50 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed">
                        {handoff.description}
                      </div>
                    </div>

                    
                    {handoff.context && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1 font-medium">{l('上下文信息', 'Context')}</div>
                        <div className="text-sm text-gray-400 bg-gray-800/30 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto border border-gray-700/50">
                          {handoff.context}
                        </div>
                      </div>
                    )}

                    
                    {handoff.result && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1 font-medium">
                          {handoff.status === 'completed' ? l('完成结果', 'Completion Result') : l('拒绝原因', 'Rejection Reason')}
                        </div>
                        <div className="text-sm text-gray-300 bg-gray-800/30 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed">
                          {handoff.result}
                        </div>
                      </div>
                    )}

                    
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>{l('创建', 'Created')}: {new Date(handoff.created_at).toLocaleString(locale)}</span>
                      {handoff.accepted_at && <span>{l('接收', 'Accepted')}: {new Date(handoff.accepted_at).toLocaleString(locale)}</span>}
                      {handoff.completed_at && <span>{l('完成', 'Completed')}: {new Date(handoff.completed_at).toLocaleString(locale)}</span>}
                    </div>

                    
                    <div className="flex gap-2 pt-2 border-t border-gray-800">
                      {handoff.status === 'pending' && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAccept(handoff.id); }}
                            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                          >
                            {l('📥 接收任务', '📥 Accept')}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReject(handoff.id); }}
                            className="bg-red-700 hover:bg-red-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                          >
                            {l('❌ 拒绝', '❌ Reject')}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancel(handoff.id); }}
                            className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                          >
                            {l('取消', 'Cancel')}
                          </button>
                        </>
                      )}
                      {handoff.status === 'accepted' && (
                        <div className="w-full">
                          <div className="flex items-center gap-2 mb-2 p-2 bg-blue-900/20 border border-blue-700/40 rounded-lg">
                            <span className="text-blue-300 text-sm">⚠️</span>
                            <span className="text-blue-300 text-xs">{l('任务已接收，请确认后开始执行。目标 Agent（', 'Task accepted. Confirm to start execution. Target Agent (')}{getAgentName(agents, handoff.to_agent_id, isZh)}{l('）将收到任务指令。', ') will receive the task command.')}</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleConfirm(handoff.id); }}
                              disabled={confirmingId === handoff.id}
                              className="bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:text-green-400 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                            >
                              ✅ {confirmingId === handoff.id ? l('正在执行...', 'Running...') : l('确认执行', 'Confirm Execution')}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReject(handoff.id); }}
                              className="bg-red-700 hover:bg-red-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                            >
                              {l('❌ 拒绝', '❌ Reject')}
                            </button>
                          </div>
                        </div>
                      )}
                      {handoff.status === 'working' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleComplete(handoff.id); }}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                        >
                          {l('✅ 标记为完成', '✅ Mark Completed')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-lg font-bold text-white">🔄 {l('新建任务交接', 'New Task Handoff')}</h3>
              <button
                onClick={() => setShowCreateDialog(false)}
                className="text-gray-500 hover:text-gray-300 text-xl"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">{l('来源 Agent', 'From Agent')}</label>
                  <select
                    value={formFrom}
                    onChange={e => setFormFrom(e.target.value as AgentRole)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-5 text-gray-500 text-lg">→</div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">{l('目标 Agent', 'To Agent')}</label>
                  <select
                    value={formTo}
                    onChange={e => setFormTo(e.target.value as AgentRole)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    {agents.filter(a => a.id !== formFrom).map(a => (
                      <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{l('优先级', 'Priority')}</label>
                <div className="flex gap-2">
                  {(['low', 'normal', 'high', 'urgent'] as HandoffPriority[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setFormPriority(p)}
                      className={`text-xs px-3 py-1 rounded-lg border transition-all ${
                        formPriority === p
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {({ low: l('低', 'Low'), normal: l('普通', 'Normal'), high: l('高', 'High'), urgent: l('紧急', 'Urgent') } as Record<HandoffPriority, string>)[p]}
                    </button>
                  ))}
                </div>
              </div>

              
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{l('任务标题', 'Task Title')} *</label>
                <input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder={l('例如：游戏策划案评审', 'e.g. Game Design Review')}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{l('任务描述', 'Task Description')} *</label>
                <textarea
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  placeholder={l('详细描述需要目标 Agent 完成的工作...', 'Describe what the target agent should complete...')}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                  {l('上下文信息', 'Context')} <span className="text-gray-600">{l('(可选)', '(optional)')}</span>
                </label>
                <textarea
                  value={formContext}
                  onChange={e => setFormContext(e.target.value)}
                  placeholder={l('补充信息，如相关文件路径、参考资料等...', 'Add extra info such as file paths or references...')}
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>

            
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                {l('取消', 'Cancel')}
              </button>
              <button
                onClick={handleCreateHandoff}
                disabled={!formTitle.trim() || !formDesc.trim() || submitting}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                {submitting ? l('创建中...', 'Creating...') : l('创建交接', 'Create Handoff')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
