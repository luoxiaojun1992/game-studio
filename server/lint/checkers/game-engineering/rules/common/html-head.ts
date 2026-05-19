/**
 * html-head: MUST 包含 <head> 标签
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from './utils.js';

const RE_HEAD = /<head[\s>]/i;

export const htmlHeadRule: GameRule = {
  ruleId: 'html-head',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    if (!RE_HEAD.test(content)) {
      return [{ ruleId: 'html-head', level: 'error', message: '缺少 <head> 标签。文档应包含 head 区域。' }];
    }
    return [];
  },
};
