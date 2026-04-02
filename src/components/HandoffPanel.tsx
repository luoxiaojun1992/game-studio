import React, { useState, useEffect } from 'react';
import { Agent, AgentRole, Handoff, HandoffStatus, HandoffPriority } from '../types';
import { api, API_BASE } from '../config';

interface Props {
  agents: Agent[];
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

function getAgentName(agents: Agent[], agentId: string): string {
  const agent = agents.find(a => a.id === agentId);
  return agent ? agent.name : agentId;
}

export default function HandoffPanel({ agents }: Props) {
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<HandoffStatus | 'all'>('all');

  // 新建交接表单
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
      const data = await api.getHandoffs();
      if (Array.isArray(data)) {
        setHandoffs(data);
      } else if (data.handoffs) {
        setHandoffs(data.handoffs);
      }
    } catch {}
  };

  useEffect(() => {
    loadHandoffs();
  }, []);

  const handleCreateHandoff = async () => {
    if (!formTitle.trim() || !formDesc.trim()) return;
    setSubmitting(true);
    try {
      await api.createHandoff({
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
      await fetch(`${API_BASE}/api/handoffs/${id}/confirm`, { method: 'POST' }).then(r => r.json());
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

  // 快捷交接：选择常用流程
  const quickHandoffs = [
    { from: 'game_designer' as AgentRole, to: 'ceo' as AgentRole, title: '游戏策划案评审', desc: '请评审最新的游戏策划案，确认游戏概念和玩法设计的可行性。' },
    { from: 'ceo' as AgentRole, to: 'architect' as AgentRole, title: '技术架构设计', desc: '策划案已通过，请基于策划案设计技术架构方案。' },
    { from: 'architect' as AgentRole, to: 'engineer' as AgentRole, title: '技术开发任务', desc: '技术方案已确定，请按照方案进行游戏开发实现。' },
    { from: 'game_designer' as AgentRole, to: 'biz_designer' as AgentRole, title: '商业策划需求', desc: '游戏策划案已完成，请基于策划案设计商业模式。' },
    { from: 'engineer' as AgentRole, to: 'game_designer' as AgentRole, title: '开发完成确认', desc: '游戏开发已完成，请确认是否符合策划要求。' },
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

  // 计算交接链（用于可视化流水线）
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

  return (
    <div className="h-full flex flex-col">
      {/* 头部操作栏 */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">🔄 任务交接</h2>
          {pendingCount > 0 && (
            <span className="bg-yellow-500/20 text-yellow-300 border border-yellow-600/40 text-xs px-2 py-0.5 rounded-full">
              {pendingCount} 个待接收
            </span>
          )}
          {activeCount > 0 && (
            <span className="bg-green-500/20 text-green-300 border border-green-600/40 text-xs px-2 py-0.5 rounded-full">
              {activeCount} 个活跃中
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + 新建交接
          </button>
        </div>
      </div>

      {/* 交接流水线可视化 */}
      <div className="shrink-0 bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">📋 交接流水线</h3>
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
                  <span className="text-xs font-medium text-white truncate">{getAgentName(agents, step.agent)}</span>
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
                    <span className="text-gray-600">空闲</span>
                  )}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* 快捷交接 */}
      <div className="shrink-0 bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">⚡ 快捷交接</h3>
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

      {/* 筛选标签 */}
      <div className="shrink-0 flex items-center gap-1.5 mb-3">
        {[
          { key: 'all' as const, label: '全部' },
          { key: 'pending' as const, label: '待接收' },
          { key: 'accepted' as const, label: '已接收' },
          { key: 'working' as const, label: '处理中' },
          { key: 'completed' as const, label: '已完成' },
        ].map(tab => (
          <button
            key={tab.key}
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

      {/* 交接列表 */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {filteredHandoffs.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-600">
            <div className="text-center">
              <div className="text-4xl mb-2">🔄</div>
              <p className="text-sm">暂无交接记录</p>
              <p className="text-xs mt-1">点击「新建交接」或使用快捷交接开始</p>
            </div>
          </div>
        ) : (
          filteredHandoffs.map(handoff => {
            const statusCfg = STATUS_CONFIG[handoff.status];
            const priorityCfg = PRIORITY_CONFIG[handoff.priority];
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
                {/* 卡片头部 */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800/30"
                  onClick={() => setExpandedId(isExpanded ? null : handoff.id)}
                >
                  {/* 交接方向 */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-lg">{AGENT_EMOJI[handoff.from_agent_id]}</span>
                    <span className="text-gray-500 text-xs">→</span>
                    <span className="text-lg">{AGENT_EMOJI[handoff.to_agent_id]}</span>
                  </div>

                  {/* 标题和状态 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{handoff.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${statusCfg.bg} ${statusCfg.color}`}>
                        {statusCfg.icon} {statusCfg.label}
                      </span>
                      {handoff.priority !== 'normal' && (
                        <span className={`text-xs shrink-0 ${priorityCfg.color}`}>
                          {priorityCfg.label}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {getAgentName(agents, handoff.from_agent_id)} → {getAgentName(agents, handoff.to_agent_id)}
                      <span className="mx-2">·</span>
                      {new Date(handoff.created_at).toLocaleString('zh-CN')}
                    </div>
                  </div>

                  {/* 展开箭头 */}
                  <span className={`text-gray-500 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                </div>

                {/* 展开详情 */}
                {isExpanded && (
                  <div className="border-t border-gray-800 px-4 py-3 space-y-3">
                    {/* 描述 */}
                    <div>
                      <div className="text-xs text-gray-500 mb-1 font-medium">任务描述</div>
                      <div className="text-sm text-gray-300 bg-gray-800/50 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed">
                        {handoff.description}
                      </div>
                    </div>

                    {/* 上下文 */}
                    {handoff.context && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1 font-medium">上下文信息</div>
                        <div className="text-sm text-gray-400 bg-gray-800/30 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto border border-gray-700/50">
                          {handoff.context}
                        </div>
                      </div>
                    )}

                    {/* 结果（已完成/已拒绝时显示） */}
                    {handoff.result && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1 font-medium">
                          {handoff.status === 'completed' ? '完成结果' : '拒绝原因'}
                        </div>
                        <div className="text-sm text-gray-300 bg-gray-800/30 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed">
                          {handoff.result}
                        </div>
                      </div>
                    )}

                    {/* 时间线 */}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>创建: {new Date(handoff.created_at).toLocaleString('zh-CN')}</span>
                      {handoff.accepted_at && <span>接收: {new Date(handoff.accepted_at).toLocaleString('zh-CN')}</span>}
                      {handoff.completed_at && <span>完成: {new Date(handoff.completed_at).toLocaleString('zh-CN')}</span>}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex gap-2 pt-2 border-t border-gray-800">
                      {handoff.status === 'pending' && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAccept(handoff.id); }}
                            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                          >
                            📥 接收任务
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReject(handoff.id); }}
                            className="bg-red-700 hover:bg-red-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                          >
                            ❌ 拒绝
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancel(handoff.id); }}
                            className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                          >
                            取消
                          </button>
                        </>
                      )}
                      {handoff.status === 'accepted' && (
                        <div className="w-full">
                          <div className="flex items-center gap-2 mb-2 p-2 bg-blue-900/20 border border-blue-700/40 rounded-lg">
                            <span className="text-blue-300 text-sm">⚠️</span>
                            <span className="text-blue-300 text-xs">任务已接收，请确认后开始执行。目标 Agent（{getAgentName(agents, handoff.to_agent_id)}）将收到任务指令。</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleConfirm(handoff.id); }}
                              disabled={confirmingId === handoff.id}
                              className="bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:text-green-400 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                            >
                              ✅ {confirmingId === handoff.id ? '正在执行...' : '确认执行'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReject(handoff.id); }}
                              className="bg-red-700 hover:bg-red-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                            >
                              ❌ 拒绝
                            </button>
                          </div>
                        </div>
                      )}
                      {handoff.status === 'working' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleComplete(handoff.id); }}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                        >
                          ✅ 标记为完成
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

      {/* 新建交接对话框 */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 className="text-lg font-bold text-white">🔄 新建任务交接</h3>
              <button
                onClick={() => setShowCreateDialog(false)}
                className="text-gray-500 hover:text-gray-300 text-xl"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* 交接方向 */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">来源 Agent</label>
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
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">目标 Agent</label>
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

              {/* 优先级 */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">优先级</label>
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
                      {PRIORITY_CONFIG[p].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 标题 */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">任务标题 *</label>
                <input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="例如：游戏策划案评审"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">任务描述 *</label>
                <textarea
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  placeholder="详细描述需要目标 Agent 完成的工作..."
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* 上下文（可选） */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                  上下文信息 <span className="text-gray-600">(可选)</span>
                </label>
                <textarea
                  value={formContext}
                  onChange={e => setFormContext(e.target.value)}
                  placeholder="补充信息，如相关文件路径、参考资料等..."
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateHandoff}
                disabled={!formTitle.trim() || !formDesc.trim() || submitting}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                {submitting ? '创建中...' : '创建交接'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
