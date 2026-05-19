/**
 * html-root: MUST 包含 <html> 根标签
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from './utils.js';

const RE_HTML_TAG = /<html[\s>]/i;

export const htmlRootRule: GameRule = {
  ruleId: 'html-root',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    if (!RE_HTML_TAG.test(content)) {
      return [{ ruleId: 'html-root', level: 'error', message: '缺少 <html> 根标签。文档根元素应为 <html>。' }];
    }
    return [];
  },
};
