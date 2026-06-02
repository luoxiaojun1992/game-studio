import React, { useState, useEffect } from 'react';
import { AgentRole } from '../types';
import { api } from '../config';
import { useI18n } from '../i18n';

const GAME_GENRE_OPTIONS = [
  { value: 'action', label: '动作', en: 'Action' },
  { value: 'puzzle', label: '益智', en: 'Puzzle' },
  { value: 'rpg', label: '角色扮演', en: 'RPG' },
  { value: 'strategy', label: '策略', en: 'Strategy' },
  { value: 'casual', label: '休闲', en: 'Casual' },
  { value: 'simulation', label: '模拟经营', en: 'Simulation' },
  { value: 'sports', label: '体育', en: 'Sports' },
  { value: 'other', label: '其他', en: 'Other' },
] as const;

interface Props {
  project_id: string;
  authorAgentId: AgentRole;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function QuestionnaireForm({ project_id, authorAgentId, onSubmit, onCancel }: Props) {
  const { l } = useI18n();
  const [gameTypes, setGameTypes] = useState<Array<{ type: string; description: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0); // 0 = core info, 1 = extended info

  const [form, setForm] = useState({
    game_name: '',
    game_type: '',
    game_genre: '',
    one_liner: '',
    core_mechanic: '',
    target_audience: '',
    game_objectives: '',
    level_design: '',
    ui_ux_notes: '',
    tech_requirements: '',
    estimated_duration: '',
    reference_games: '',
    monetization_hint: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    console.log('[DEBUG:QuestionnaireForm] mounted, fetching game-types...');
    api.getGameTypes().then((data: any) => {
      console.log('[DEBUG:QuestionnaireForm] getGameTypes response:', data?.game_types?.length, 'types');
      if (data?.game_types) setGameTypes(data.game_types);
    }).catch((err) => {
      console.error('[DEBUG:QuestionnaireForm] getGameTypes failed:', err);
    });
  }, []);

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const validateStep0 = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.game_name.trim()) e.game_name = l('游戏名称必填', 'Game name is required');
    if (!form.game_genre) e.game_genre = l('游戏类型必选', 'Game genre is required');
    if (!form.one_liner.trim()) e.one_liner = l('一句话描述必填', 'One-liner is required');
    if (!form.core_mechanic.trim()) e.core_mechanic = l('核心玩法必填', 'Core mechanic is required');
    else if (form.core_mechanic.trim().length < 50) e.core_mechanic = l('核心玩法最少50字', 'Core mechanic: min 50 chars');
    if (!form.target_audience.trim()) e.target_audience = l('目标受众必填', 'Target audience is required');
    if (!form.game_objectives.trim()) e.game_objectives = l('游戏目标必填', 'Game objectives is required');
    else if (form.game_objectives.trim().length < 50) e.game_objectives = l('游戏目标最少50字', 'Game objectives: min 50 chars');
    console.log('[DEBUG:QuestionnaireForm] validateStep0 →', Object.keys(e).length === 0 ? 'PASS' : 'FAIL', { errors: e });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateStep0()) { console.log('[DEBUG:QuestionnaireForm] handleSubmit: validateStep0 failed, staying on step 0'); setStep(0); return; }
    console.log('[DEBUG:QuestionnaireForm] handleSubmit: submitting...', { game_name: form.game_name, game_type: form.game_type, game_genre: form.game_genre });
    setLoading(true);
    try {
      const payload: any = {
        project_id,
        author_agent_id: authorAgentId,
        game_name: form.game_name.trim(),
        game_genre: form.game_genre,
        one_liner: form.one_liner.trim(),
        core_mechanic: form.core_mechanic.trim(),
        target_audience: form.target_audience.trim(),
        game_objectives: form.game_objectives.trim(),
      };
      if (form.game_type) payload.game_type = form.game_type;
      if (form.level_design.trim()) payload.level_design = form.level_design.trim();
      if (form.ui_ux_notes.trim()) payload.ui_ux_notes = form.ui_ux_notes.trim();
      if (form.tech_requirements.trim()) payload.tech_requirements = form.tech_requirements.trim();
      if (form.estimated_duration.trim()) payload.estimated_duration = form.estimated_duration.trim();
      if (form.reference_games.trim()) payload.reference_games = form.reference_games.trim();
      if (form.monetization_hint.trim()) payload.monetization_hint = form.monetization_hint.trim();

      const result = await api.submitQuestionnaireProposal(payload);
      console.log('[DEBUG:QuestionnaireForm] handleSubmit: API response', result);
      if ((result as any).error) {
        console.log('[DEBUG:QuestionnaireForm] handleSubmit: API returned error', (result as any).error);
        setErrors({ _global: (result as any).error });
        return;
      }
      console.log('[DEBUG:QuestionnaireForm] handleSubmit: SUCCESS, calling onSubmit');
      onSubmit();
    } catch (err) {
      console.error('[DEBUG:QuestionnaireForm] handleSubmit: catch error', err);
      setErrors({ _global: l('提交失败，请重试', 'Submit failed, please retry') });
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500';
  const labelCls = 'block text-xs text-gray-400 mb-1.5 font-medium';
  const errorCls = 'text-xs text-red-400 mt-0.5';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <h3 className="text-lg font-bold text-white">{l('📝 问卷式策划案', '📝 Questionnaire Proposal')}</h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 text-xl">✕</button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-2 border-b border-gray-800 flex gap-4 shrink-0">
          <button
            onClick={() => setStep(0)}
            className={`text-sm font-medium ${step === 0 ? 'text-blue-400 border-b-2 border-blue-400 pb-1' : 'text-gray-500 pb-1'}`}
          >
            {l('核心信息', 'Core Info')}
          </button>
          <button
            onClick={() => { if (validateStep0()) setStep(1); }}
            className={`text-sm font-medium ${step === 1 ? 'text-blue-400 border-b-2 border-blue-400 pb-1' : 'text-gray-500 pb-1'}`}
          >
            {l('扩展信息', 'Extended Info')}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {errors._global && <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{errors._global}</div>}

          {step === 0 && (
            <>
              <div>
                <label className={labelCls}>{l('游戏名称', 'Game Name')} *</label>
                <input data-testid="q-game-name" value={form.game_name} onChange={e => updateField('game_name', e.target.value)} className={inputCls} placeholder={l('例如：星际农场', 'e.g. Star Farm')} maxLength={50} />
                {errors.game_name && <div className={errorCls}>{errors.game_name}</div>}
              </div>

              <div>
                <label className={labelCls}>{l('游戏工程类型', 'Game Engineering Type')}</label>
                <select data-testid="q-game-type" value={form.game_type} onChange={e => updateField('game_type', e.target.value)} className={inputCls}>
                  <option value="">— {l('可选', 'Optional')} —</option>
                  {gameTypes.map(gt => (
                    <option key={gt.type} value={gt.type}>{gt.description || gt.type}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>{l('游戏类型', 'Game Genre')} *</label>
                <select data-testid="q-game-genre" value={form.game_genre} onChange={e => updateField('game_genre', e.target.value)} className={inputCls}>
                  <option value="">— {l('请选择', 'Select')} —</option>
                  {GAME_GENRE_OPTIONS.map(g => (
                    <option key={g.value} value={g.value}>{l(g.label, g.en)}</option>
                  ))}
                </select>
                {errors.game_genre && <div className={errorCls}>{errors.game_genre}</div>}
              </div>

              <div>
                <label className={labelCls}>{l('一句话描述', 'One-liner')} *</label>
                <input data-testid="q-one-liner" value={form.one_liner} onChange={e => updateField('one_liner', e.target.value)} className={inputCls} placeholder={l('核心体验一句话概括', 'Elevator pitch')} maxLength={200} />
                {errors.one_liner && <div className={errorCls}>{errors.one_liner}</div>}
              </div>

              <div>
                <label className={labelCls}>{l('核心玩法', 'Core Mechanic')} * <span className="text-gray-600">(min 50)</span></label>
                <textarea data-testid="q-core-mechanic" value={form.core_mechanic} onChange={e => updateField('core_mechanic', e.target.value)} className={`${inputCls} resize-none`} rows={4} placeholder={l('玩家做什么、怎么做、有什么反馈循环', 'What players do, how they do it, feedback loops')} maxLength={2000} />
                <div className="text-xs text-gray-600 mt-0.5">{form.core_mechanic.length}/2000</div>
                {errors.core_mechanic && <div className={errorCls}>{errors.core_mechanic}</div>}
              </div>

              <div>
                <label className={labelCls}>{l('目标受众', 'Target Audience')} *</label>
                <textarea data-testid="q-target-audience" value={form.target_audience} onChange={e => updateField('target_audience', e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder={l('年龄层、玩家画像、核心诉求', 'Age group, player profile, core demands')} maxLength={500} />
                {errors.target_audience && <div className={errorCls}>{errors.target_audience}</div>}
              </div>

              <div>
                <label className={labelCls}>{l('游戏目标与胜利条件', 'Game Objectives')} * <span className="text-gray-600">(min 50)</span></label>
                <textarea data-testid="q-game-objectives" value={form.game_objectives} onChange={e => updateField('game_objectives', e.target.value)} className={`${inputCls} resize-none`} rows={4} placeholder={l('如何算赢/输、进度系统', 'Win/lose conditions, progression system')} maxLength={2000} />
                <div className="text-xs text-gray-600 mt-0.5">{form.game_objectives.length}/2000</div>
                {errors.game_objectives && <div className={errorCls}>{errors.game_objectives}</div>}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-xs text-gray-500">{l('以下均为可选，可以跳过', 'All fields below are optional')}</p>

              <div>
                <label className={labelCls}>{l('关卡/内容设计', 'Level Design')}</label>
                <textarea data-testid="q-level-design" value={form.level_design} onChange={e => updateField('level_design', e.target.value)} className={`${inputCls} resize-none`} rows={3} placeholder={l('关卡数量、难度曲线、内容类型', 'Level count, difficulty curve, content types')} maxLength={2000} />
              </div>

              <div>
                <label className={labelCls}>{l('UI/UX 设计要点', 'UI/UX Notes')}</label>
                <textarea data-testid="q-ui-ux" value={form.ui_ux_notes} onChange={e => updateField('ui_ux_notes', e.target.value)} className={`${inputCls} resize-none`} rows={3} placeholder={l('关键界面、交互方式、视觉风格', 'Key screens, interactions, visual style')} maxLength={2000} />
              </div>

              <div>
                <label className={labelCls}>{l('技术需求', 'Tech Requirements')}</label>
                <textarea data-testid="q-tech-req" value={form.tech_requirements} onChange={e => updateField('tech_requirements', e.target.value)} className={`${inputCls} resize-none`} rows={3} placeholder={l('引擎、平台、特殊技术', 'Engine, platform, special tech')} maxLength={2000} />
              </div>

              <div>
                <label className={labelCls}>{l('预期开发周期', 'Estimated Duration')}</label>
                <input data-testid="q-duration" value={form.estimated_duration} onChange={e => updateField('estimated_duration', e.target.value)} className={inputCls} placeholder={l('例如：2-3周', 'e.g. 2-3 weeks')} maxLength={100} />
              </div>

              <div>
                <label className={labelCls}>{l('参考竞品', 'Reference Games')}</label>
                <textarea data-testid="q-ref-games" value={form.reference_games} onChange={e => updateField('reference_games', e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder={l('列举1-3个类似游戏及差异化点', 'List 1-3 similar games and differentiation')} maxLength={500} />
              </div>

              <div>
                <label className={labelCls}>{l('商业化方向', 'Monetization')}</label>
                <textarea data-testid="q-monetization" value={form.monetization_hint} onChange={e => updateField('monetization_hint', e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder={l('免费/付费/F2P/广告等', 'Free/Paid/F2P/Ads etc.')} maxLength={500} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between px-6 py-4 border-t border-gray-800 shrink-0">
          {step === 0 ? (
            <button onClick={onCancel} className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium px-5 py-2 rounded-lg transition-colors">
              {l('取消', 'Cancel')}
            </button>
          ) : (
            <button onClick={() => setStep(0)} className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium px-5 py-2 rounded-lg transition-colors">
              {l('← 上一步', '← Previous')}
            </button>
          )}
          {step === 0 ? (
            <button
              data-testid="q-next-step"
              onClick={() => { if (validateStep0()) setStep(1); }}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {l('下一步 →', 'Next →')}
            </button>
          ) : (
            <button
              data-testid="q-submit"
              onClick={handleSubmit}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {loading ? l('提交中...', 'Submitting...') : l('提交策划案', 'Submit Proposal')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
