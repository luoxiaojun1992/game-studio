/**
 * lifecycle-exports: GameApp MUST 实现全部 6 个生命周期方法
 * init/start/pause/resume/resize/destroy
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from '../common/utils.js';

const REQUIRED_METHODS = ['init', 'start', 'pause', 'resume', 'resize', 'destroy'];

export const lifecycleExportsRule: GameRule = {
  ruleId: 'lifecycle-exports',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    // 使用 negative lookbehind 防止误匹配（如 reinitialize → init 被误判）
    const RE_METHOD = new RegExp(
      REQUIRED_METHODS.map(m => `(?<![\\w$.])${m}\\s*\\(`).join('|'), 'g'
    );
    const found = new Set(
      (content.match(RE_METHOD) || []).map(m => m.replace(/\s*\($/, ''))
    );
    const missing = REQUIRED_METHODS.filter(m => !found.has(m));

    if (missing.length > 0) {
      return [{
        ruleId: 'lifecycle-exports',
        level: 'error',
        message: `缺少 GameApp 生命周期方法：${missing.join('、')}。GameApp MUST 实现全部 6 个方法（init/start/pause/resume/resize/destroy）。`,
      }];
    }
    return [];
  },
};
