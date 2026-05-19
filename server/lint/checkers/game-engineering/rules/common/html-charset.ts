/**
 * html-charset: <head> 中 MUST 包含 <meta charset="utf-8">
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from './utils.js';

const RE_CHARSET_META = /<meta\s[^>]*charset=["']?utf-8["']?/i;
const RE_HEAD = /<head[\s>]/i;

export const htmlCharsetRule: GameRule = {
  ruleId: 'html-charset',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    // 无 <head> 时条件通过（由 html-head 规则检测）
    if (!RE_HEAD.test(content)) return [];

    if (!RE_CHARSET_META.test(content)) {
      return [{ ruleId: 'html-charset', level: 'error', message: '缺少字符编码声明 <meta charset="utf-8">。' }];
    }
    return [];
  },
};
