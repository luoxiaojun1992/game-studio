/**
 * html-body-not-empty: <body> MUST 有可见内容
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from './utils.js';

export const htmlBodyNotEmptyRule: GameRule = {
  ruleId: 'html-body-not-empty',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    const bodyMatch = content.match(/<body[^>]*>([^]*)<\/body>/i);
    if (!bodyMatch) return []; // 由 html-body 规则检测，此处不重复报错

    const bodyContent = bodyMatch[1];
    // 去除 HTML 注释（循环替换，避免多字符清洗后重新拼接出注释起始标记）
    let noComments = bodyContent;
    let previous: string;
    do {
      previous = noComments;
      noComments = noComments.replace(/<!--[^]*?-->/g, '');
    } while (noComments !== previous);
    // 去除所有 HTML 标签
    const noTags = noComments.replace(/<[^>]+>/g, '');
    // 检查是否只剩空白
    if (noTags.trim().length === 0) {
      return [{ ruleId: 'html-body-not-empty', level: 'error', message: '<body> 内容为空或仅含空白与注释。' }];
    }
    return [];
  },
};
