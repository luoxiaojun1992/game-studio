/**
 * html-doctype: MUST 包含 <!DOCTYPE html> 声明（大小写不敏感）
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from './utils.js';

const RE_DOCTYPE = /<!DOCTYPE\s+html>/i;
const RE_BODY = /<body[\s>]/i;

export const htmlDoctypeRule: GameRule = {
  ruleId: 'html-doctype',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    const bodyIndex = content.search(RE_BODY);
    const target = bodyIndex >= 0 ? content.slice(0, bodyIndex) : content;
    if (!RE_DOCTYPE.test(target)) {
      return [{ ruleId: 'html-doctype', level: 'error', message: '缺少 <!DOCTYPE html> 声明。HTML5 文档必须以 <!DOCTYPE html> 开头。' }];
    }
    return [];
  },
};
