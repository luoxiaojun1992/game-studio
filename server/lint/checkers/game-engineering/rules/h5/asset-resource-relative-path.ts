/**
 * asset-resource-relative-path: index.html 中引用的资源路径 MUST 使用相对路径
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from '../common/utils.js';

const RE_ABSOLUTE_URL = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;

export const assetResourceRelativePathRule: GameRule = {
  ruleId: 'asset-resource-relative-path',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    const results: CheckerResult[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(RE_ABSOLUTE_URL.source, 'gi');

    while ((match = re.exec(content)) !== null) {
      results.push({
        ruleId: 'asset-resource-relative-path',
        level: 'error',
        message: `检测到绝对路径资源引用：${match[1]}。所有资源 MUST 使用相对路径。`,
      });
    }
    return results;
  },
};
