import React from 'react';
import { Proposal, ProposalStatus } from '../types';

interface Props {
  proposals: Proposal[];
  selectedId?: string;
  onSelect: (proposal: Proposal) => void;
}

const TYPE_LABELS: Record<string, string> = {
  game_design: '🎮 游戏策划',
  biz_design: '💼 商业策划',
  tech_arch: '🏗️ 技术架构',
  tech_impl: '👨‍💻 技术方案',
  ceo_review: '👔 CEO评审',
};

const STATUS_CONFIG: Record<ProposalStatus, { label: string; className: string }> = {
  pending_review: { label: '待评审', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-600/40' },
  under_review: { label: '评审中', className: 'bg-blue-500/20 text-blue-300 border-blue-600/40' },
  approved: { label: '已通过', className: 'bg-green-500/20 text-green-300 border-green-600/40' },
  rejected: { label: '已拒绝', className: 'bg-red-500/20 text-red-300 border-red-600/40' },
  revision_needed: { label: '需修改', className: 'bg-orange-500/20 text-orange-300 border-orange-600/40' },
  user_approved: { label: '✅ 已批准', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-600/40' },
  user_rejected: { label: '❌ 已驳回', className: 'bg-rose-500/20 text-rose-300 border-rose-600/40' },
};

export default function ProposalList({ proposals, selectedId, onSelect }: Props) {
  const pending = proposals.filter(p => p.status === 'pending_review' || p.status === 'under_review');
  const others = proposals.filter(p => p.status !== 'pending_review' && p.status !== 'under_review');

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="font-semibold text-gray-200 text-sm">提案列表</h3>
        <span className="text-xs text-gray-500">{proposals.length} 份</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {pending.length > 0 && (
          <>
            <div className="text-xs text-yellow-400 px-2 py-1 font-medium">⏳ 待人工审批</div>
            {pending.map(p => (
              <ProposalItem key={p.id} proposal={p} selected={p.id === selectedId} onClick={() => onSelect(p)} />
            ))}
          </>
        )}
        {others.length > 0 && (
          <>
            <div className="text-xs text-gray-500 px-2 py-1 font-medium mt-2">已处理</div>
            {others.map(p => (
              <ProposalItem key={p.id} proposal={p} selected={p.id === selectedId} onClick={() => onSelect(p)} />
            ))}
          </>
        )}
        {proposals.length === 0 && (
          <div className="text-center text-gray-600 text-sm py-8">
            <div className="text-3xl mb-2">📋</div>
            暂无提案
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalItem({ proposal, selected, onClick }: { proposal: Proposal; selected: boolean; onClick: () => void }) {
  const statusCfg = STATUS_CONFIG[proposal.status];
  return (
    <div
      onClick={onClick}
      className={`rounded-lg p-3 cursor-pointer transition-all border ${
        selected
          ? 'bg-blue-900/30 border-blue-600/50'
          : 'bg-gray-800/50 border-transparent hover:bg-gray-800 hover:border-gray-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-gray-500">{TYPE_LABELS[proposal.type] || proposal.type}</span>
      </div>
      <p className="text-sm text-gray-200 font-medium leading-snug truncate">{proposal.title}</p>
      <p className="text-[11px] text-gray-500 mt-1">项目：{proposal.project_id}</p>
      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-xs px-1.5 py-0.5 rounded border ${statusCfg.className}`}>
          {statusCfg.label}
        </span>
        <span className="text-xs text-gray-600">
          {new Date(proposal.created_at).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </div>
  );
}
