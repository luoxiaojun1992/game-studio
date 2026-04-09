import React from 'react';
import { Proposal, ProposalStatus } from '../types';
import { useI18n } from '../i18n';

interface Props {
  proposals: Proposal[];
  selectedId?: string;
  onSelect: (proposal: Proposal) => void;
}

export default function ProposalList({ proposals, selectedId, onSelect }: Props) {
  const { l } = useI18n();
  const pending = proposals.filter(p => p.status === 'pending_review' || p.status === 'under_review');
  const others = proposals.filter(p => p.status !== 'pending_review' && p.status !== 'under_review');

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="font-semibold text-gray-200 text-sm">{l('提案列表', 'Proposals')}</h3>
        <span className="text-xs text-gray-500">{proposals.length} {l('份', 'items')}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {pending.length > 0 && (
          <>
            <div className="text-xs text-yellow-400 px-2 py-1 font-medium">⏳ {l('待人工审批', 'Waiting for Manual Review')}</div>
            {pending.map(p => (
              <ProposalItem key={p.id} proposal={p} selected={p.id === selectedId} onClick={() => onSelect(p)} />
            ))}
          </>
        )}
        {others.length > 0 && (
          <>
            <div className="text-xs text-gray-500 px-2 py-1 font-medium mt-2">{l('已处理', 'Processed')}</div>
            {others.map(p => (
              <ProposalItem key={p.id} proposal={p} selected={p.id === selectedId} onClick={() => onSelect(p)} />
            ))}
          </>
        )}
        {proposals.length === 0 && (
          <div className="text-center text-gray-600 text-sm py-8">
            <div className="text-3xl mb-2">📋</div>
            {l('暂无提案', 'No proposals yet')}
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalItem({ proposal, selected, onClick }: { proposal: Proposal; selected: boolean; onClick: () => void }) {
  const { l, locale } = useI18n();

  const typeLabels: Record<string, string> = {
    game_design: l('🎮 游戏策划', '🎮 Game Design'),
    biz_design: l('💼 商业策划', '💼 Business Design'),
    tech_arch: l('🏗️ 技术架构', '🏗️ Architecture'),
    tech_impl: l('👨‍💻 技术方案', '👨‍💻 Technical Plan'),
    ceo_review: l('👔 CEO评审', '👔 CEO Review'),
  };

  const statusCfg: Record<ProposalStatus, { label: string; className: string }> = {
    pending_review: { label: l('待评审', 'Pending Review'), className: 'bg-yellow-500/20 text-yellow-300 border-yellow-600/40' },
    under_review: { label: l('评审中', 'In Review'), className: 'bg-blue-500/20 text-blue-300 border-blue-600/40' },
    approved: { label: l('已通过', 'Approved'), className: 'bg-green-500/20 text-green-300 border-green-600/40' },
    rejected: { label: l('已拒绝', 'Rejected'), className: 'bg-red-500/20 text-red-300 border-red-600/40' },
    revision_needed: { label: l('需修改', 'Needs Revision'), className: 'bg-orange-500/20 text-orange-300 border-orange-600/40' },
    user_approved: { label: l('✅ 已批准', '✅ User Approved'), className: 'bg-emerald-500/20 text-emerald-300 border-emerald-600/40' },
    user_rejected: { label: l('❌ 已驳回', '❌ User Rejected'), className: 'bg-rose-500/20 text-rose-300 border-rose-600/40' },
  }[proposal.status];

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
        <span className="text-xs text-gray-500">{typeLabels[proposal.type] || proposal.type}</span>
      </div>
      <p className="text-sm text-gray-200 font-medium leading-snug truncate">{proposal.title}</p>
      <p className="text-[11px] text-gray-500 mt-1">{l('项目', 'Project')}: {proposal.project_id}</p>
      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-xs px-1.5 py-0.5 rounded border ${statusCfg.className}`}>
          {statusCfg.label}
        </span>
        <span className="text-xs text-gray-600">
          {new Date(proposal.created_at).toLocaleDateString(locale)}
        </span>
      </div>
    </div>
  );
}
