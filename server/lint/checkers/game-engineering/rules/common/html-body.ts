/**
 * html-body: MUST 包含 <body> 标签
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from './utils.js';

const RE_BODY = /<body[\s>]/i;

export const htmlBodyRule: GameRule = {
  ruleId: 'html-body',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    if (!RE_BODY.test(content)) {
      return [{ ruleId: 'html-body', level: 'error', message: '缺少 <body> 标签。游戏内容应在 body 中渲染。' }];
    }
    return [];
  },
};
