/**
 * lifecycle-window-global: GameApp 实例 MUST 挂载到 window.__GAME__
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from '../common/utils.js';

const RE_WINDOW_GAME = /window\.__GAME__\s*=/;

export const lifecycleWindowGlobalRule: GameRule = {
  ruleId: 'lifecycle-window-global',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    if (!RE_WINDOW_GAME.test(content)) {
      return [{ ruleId: 'lifecycle-window-global', level: 'error', message: '缺少 window.__GAME__ 挂载。GameApp 实例 MUST 赋值给 window.__GAME__。' }];
    }
    return [];
  },
};
