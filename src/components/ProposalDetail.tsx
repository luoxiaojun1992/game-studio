import React, { useState, useEffect } from 'react';
import { Proposal, ProposalAttachment } from '../types';
import { useI18n } from '../i18n';
import { api } from '../config';

interface Props {
  proposal: Proposal;
  onDecide: (id: string, decision: 'approved' | 'rejected', comment: string) => void;
  onClose: () => void;
}

const AGENT_NAMES_ZH: Record<string, string> = {
  engineer: '👨‍💻 软件工程师',
  architect: '🏗️ 架构师',
  game_designer: '🎮 游戏策划',
  biz_designer: '💼 商业策划',
  ceo: '👔 CEO',
  team_builder: '🧠 团队建设',
};

const AGENT_NAMES_EN: Record<string, string> = {
  engineer: '👨‍💻 Engineer',
  architect: '🏗️ Architect',
  game_designer: '🎮 Game Designer',
  biz_designer: '💼 Business Designer',
  ceo: '👔 CEO',
  team_builder: '🧠 Team Building',
};

const TYPE_LABELS_ZH: Record<string, string> = {
  game_design: '🎮 游戏策划案',
  biz_design: '💼 商业策划案',
  tech_arch: '🏗️ 技术架构方案',
  tech_impl: '👨‍💻 技术实现方案',
  ceo_review: '👔 CEO评审意见',
};

const TYPE_LABELS_EN: Record<string, string> = {
  game_design: '🎮 Game Design Proposal',
  biz_design: '💼 Business Plan',
  tech_arch: '🏗️ Architecture Plan',
  tech_impl: '👨‍💻 Implementation Plan',
  ceo_review: '👔 CEO Review',
};

const CONTENT_TYPE_ICONS: Record<string, string> = {
  'image/png': '🖼️',
  'image/svg+xml': '📐',
  'application/pdf': '📄',
  'application/xml': '📝',
};

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProposalDetail({ proposal, onDecide, onClose }: Props) {
  const { l, locale, isZh } = useI18n();
  const AGENT_NAMES = isZh ? AGENT_NAMES_ZH : AGENT_NAMES_EN;
  const TYPE_LABELS = isZh ? TYPE_LABELS_ZH : TYPE_LABELS_EN;
  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [attachments, setAttachments] = useState<ProposalAttachment[]>([]);
  const [attachmentExtra, setAttachmentExtra] = useState<Record<string, { file_name: string | null; file_size: number | null; content_type: string | null }>>({});
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const canDecide = proposal.status !== 'user_approved' && proposal.status !== 'user_rejected';

  useEffect(() => {
    if (!proposal.id) return;
    setAttachmentsLoading(true);
    api.getProposalAttachments(proposal.id)
      .then((data: any) => {
        setAttachments(data.attachments || []);
        const extraMap: Record<string, { file_name: string | null; file_size: number | null; content_type: string | null }> = {};
        (data.attachments || []).forEach((att: any) => {
          extraMap[att.id] = {
            file_name: att.file_name,
            file_size: att.file_size,
            content_type: att.content_type,
          };
        });
        setAttachmentExtra(extraMap);
      })
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));
  }, [proposal.id]);

  const handleDownload = async (attachment: ProposalAttachment) => {
    setDownloadingId(attachment.id);
    try {
      const data = await api.getProposalAttachmentDownloadUrl(proposal.id, attachment.id);
      window.open(data.downloadUrl, '_blank');
    } catch {
      // ignore
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (attachment: ProposalAttachment) => {
    try {
      await api.deleteProposalAttachment(proposal.id, attachment.id);
      setAttachments(prev => prev.filter(a => a.id !== attachment.id));
    } catch {
      // ignore
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await api.uploadProposalAttachment(proposal.id, file);
      }
      // 刷新附件列表
      const data: any = await api.getProposalAttachments(proposal.id);
      setAttachments(data.attachments || []);
      const extraMap: Record<string, { file_name: string | null; file_size: number | null; content_type: string | null }> = {};
      (data.attachments || []).forEach((att: any) => {
        extraMap[att.id] = { file_name: att.file_name, file_size: att.file_size, content_type: att.content_type };
      });
      setAttachmentExtra(extraMap);
    } catch {
      // ignore
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDecide = async (decision: 'approved' | 'rejected') => {
    setDeciding(true);
    await onDecide(proposal.id, decision, comment);
    setDeciding(false);
  };

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col h-full">
      <div className="px-5 py-4 border-b border-gray-800 flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-500 mb-1">{TYPE_LABELS[proposal.type] || proposal.type}</div>
          <h2 className="text-base font-bold text-white">{proposal.title}</h2>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{l('作者', 'Author')}: {AGENT_NAMES[proposal.author_agent_id] || proposal.author_agent_id}</span>
            <span>v{proposal.version}</span>
            <span>{new Date(proposal.created_at).toLocaleString(locale)}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xl ml-4">✕</button>
      </div>

      
      <div className="flex-1 overflow-y-auto p-5">
        <div className="prose prose-invert max-w-none">
          <pre className="whitespace-pre-wrap text-gray-300 text-sm leading-relaxed font-sans bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            {proposal.content}
          </pre>
        </div>

        {/* 附件列表 */}
        <div className="mt-4 bg-gray-800/30 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-gray-400 font-medium">
              📎 {l('策划案附件', 'Attachments')} {attachmentsLoading ? '...' : `(${attachments.length})`}
            </div>
            <label className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer px-2 py-1 rounded hover:bg-gray-700 transition-colors disabled:opacity-50">
              {uploading ? l('上传中...', 'Uploading...') : l('+ 添加附件', '+ Add')}
              <input
                type="file"
                multiple
                onChange={handleUpload}
                disabled={uploading || attachmentsLoading}
                className="hidden"
              />
            </label>
          </div>
          {attachmentsLoading ? (
            <div className="text-xs text-gray-500">{l('加载中...', 'Loading...')}</div>
          ) : attachments.length === 0 ? (
            <div className="text-xs text-gray-600">{l('暂无附件，点击"添加附件"上传文件', 'No attachments yet')}</div>
          ) : (
              <div className="space-y-2">
                {attachments.map(att => {
                  const extra = attachmentExtra[att.id] || {};
                  const icon = CONTENT_TYPE_ICONS[extra.content_type || ''] || '📎';
                  const displayName = att.custom_name || extra.file_name || l('未命名文件', 'Unnamed file');
                  return (
                    <div key={att.id} className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm flex-shrink-0">{icon}</span>
                        <span className="text-sm text-gray-200 truncate" title={displayName}>
                          {att.custom_name && extra.file_name ? (
                            <span>{att.custom_name}<span className="text-gray-500 text-xs ml-1">({extra.file_name})</span></span>
                          ) : displayName}
                        </span>
                        {extra.file_size && (
                          <span className="text-xs text-gray-500 flex-shrink-0">{formatFileSize(extra.file_size)}</span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                          att.source_type === 'drawio_export' ? 'bg-blue-900/50 text-blue-300' : 'bg-green-900/50 text-green-300'
                        }`}>
                          {att.source_type === 'drawio_export' ? 'draw.io' : 'manual'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <button
                          onClick={() => handleDownload(att)}
                          disabled={downloadingId === att.id}
                          title={l('下载', 'Download')}
                          className="text-gray-400 hover:text-blue-400 text-xs px-2 py-1 rounded hover:bg-gray-700 disabled:opacity-50 transition-colors"
                        >
                          {downloadingId === att.id ? '...' : l('下载', 'DL')}
                        </button>
                        <button
                          onClick={() => handleDelete(att)}
                          title={l('删除', 'Delete')}
                          className="text-gray-400 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
          )}
        </div>

        {proposal.reviewer_agent_id && proposal.review_comment && (
          <div className="mt-4 bg-blue-900/20 border border-blue-700/40 rounded-lg p-4">
            <div className="text-xs text-blue-400 font-medium mb-2">
              {l('👔 CEO 评审意见', '👔 CEO Review')} {l('（', '(')}{AGENT_NAMES[proposal.reviewer_agent_id]}{l('）', ')')}
            </div>
            <pre className="text-sm text-blue-200 whitespace-pre-wrap font-sans leading-relaxed">
              {proposal.review_comment}
            </pre>
          </div>
        )}

        
        {proposal.user_decision && (
          <div className={`mt-4 rounded-lg p-4 border ${
            proposal.user_decision === 'approved'
              ? 'bg-green-900/20 border-green-700/40'
              : 'bg-red-900/20 border-red-700/40'
          }`}>
            <div className={`text-xs font-medium mb-2 ${
              proposal.user_decision === 'approved' ? 'text-green-400' : 'text-red-400'
            }`}>
              {proposal.user_decision === 'approved' ? l('✅ 已批准', '✅ Approved') : l('❌ 已驳回', '❌ Rejected')} {l('（', '(')}{l('人工审批', 'Manual Review')}{l('）', ')')}
            </div>
            {proposal.user_comment && (
              <p className="text-sm text-gray-300">{proposal.user_comment}</p>
            )}
          </div>
        )}
      </div>

      
      {canDecide && (
        <div className="px-5 py-4 border-t border-gray-800 bg-gray-900/50">
          <div className="text-sm font-semibold text-gray-200 mb-3">🧑‍⚖️ {l('人工审批', 'Manual Review')}</div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={l('填写审批意见（可选）...', 'Add a review comment (optional)...')}
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600 resize-none mb-3"
          />
          <div className="flex gap-3">
            <button
              onClick={() => handleDecide('approved')}
              disabled={deciding}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
            >
              {l('✅ 批准方案', '✅ Approve')}
            </button>
            <button
              onClick={() => handleDecide('rejected')}
              disabled={deciding}
              className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
            >
              {l('❌ 驳回方案', '❌ Reject')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
