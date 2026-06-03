/**
 * lifecycle-phaser-script-tag: index.html MUST 包含 <script> 标签加载游戏 JS bundle
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readEntryHtml } from '../common/utils.js';

const RE_SCRIPT = /<script[\s>]/i;

export const lifecyclePhaserScriptTagRule: GameRule = {
  ruleId: 'lifecycle-phaser-script-tag',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const content = readEntryHtml(submitDir);
    if (!content) return [];

    if (!RE_SCRIPT.test(content)) {
      return [{ ruleId: 'lifecycle-phaser-script-tag', level: 'error', message: '缺少 <script> 标签。index.html MUST 包含 <script> 标签加载 Phaser 游戏脚本。' }];
    }
    return [];
  },
};
