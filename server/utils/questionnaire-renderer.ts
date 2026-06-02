/**
 * SPEC-007: 问卷渲染引擎
 * 将结构化问卷字段渲染为标准化 Markdown
 */

export const GAME_GENRE_OPTIONS = ['action', 'puzzle', 'rpg', 'strategy', 'casual', 'simulation', 'sports', 'other'] as const;
export type GameGenre = (typeof GAME_GENRE_OPTIONS)[number];

export const GAME_GENRE_LABELS: Record<GameGenre, string> = {
  action: '动作',
  puzzle: '益智',
  rpg: '角色扮演',
  strategy: '策略',
  casual: '休闲',
  simulation: '模拟经营',
  sports: '体育',
  other: '其他',
};

export interface QuestionnaireInput {
  game_name: string;
  game_type?: string;
  game_genre: GameGenre;
  one_liner: string;
  core_mechanic: string;
  target_audience: string;
  game_objectives: string;
  level_design?: string;
  ui_ux_notes?: string;
  tech_requirements?: string;
  estimated_duration?: string;
  reference_games?: string;
  monetization_hint?: string;
}

export function renderQuestionnaireToMarkdown(input: QuestionnaireInput): string {
  const genreLabel = GAME_GENRE_LABELS[input.game_genre] || input.game_genre;

  return `# ${input.game_name}

> ${input.one_liner}

## 1. 游戏工程类型
${input.game_type || '（待补充）'}

## 2. 游戏类型
${genreLabel}

## 3. 核心玩法
${input.core_mechanic}

## 4. 目标受众
${input.target_audience}

## 5. 游戏目标与胜利条件
${input.game_objectives}

## 6. 关卡/内容设计
${input.level_design || '（待补充）'}

## 7. UI/UX 设计要点
${input.ui_ux_notes || '（待补充）'}

## 8. 技术需求
${input.tech_requirements || '（待补充）'}

## 9. 预期开发周期
${input.estimated_duration || '（待补充）'}

## 10. 参考竞品
${input.reference_games || '（无）'}

## 11. 商业化方向
${input.monetization_hint || '（待补充）'}
`;
}
