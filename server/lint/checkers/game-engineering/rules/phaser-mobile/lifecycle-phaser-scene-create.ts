/**
 * lifecycle-phaser-scene-create: 至少一个 Scene 类 MUST 定义 create() 方法
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readAllJsContent } from '../common/utils.js';

// 匹配 create() 方法定义，使用负向后顾防止变量名误匹配（如 _create、recreate）
const RE_CREATE = /(?<![\\w$])create\s*\(/;

export const lifecyclePhaserSceneCreateRule: GameRule = {
  ruleId: 'lifecycle-phaser-scene-create',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const jsContent = readAllJsContent(submitDir);
    if (!jsContent) return [{ ruleId: 'lifecycle-phaser-scene-create', level: 'error', message: '缺少 create() 方法定义。phaser-mobile 游戏至少一个 Scene MUST 定义 create() 初始化场景。' }];

    if (!RE_CREATE.test(jsContent)) {
      return [{ ruleId: 'lifecycle-phaser-scene-create', level: 'error', message: '缺少 create() 方法定义。phaser-mobile 游戏至少一个 Scene MUST 定义 create() 初始化场景。' }];
    }
    return [];
  },
};
