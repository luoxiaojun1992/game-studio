/**
 * lifecycle-phaser-scene-preload: 至少一个 Scene 类 MUST 定义 preload() 方法
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readAllJsContent } from '../common/utils.js';

// 匹配 preload() 方法定义，使用负向后顾防止变量名误匹配（如 _preload）
const RE_PRELOAD = /(?<![\\w$])preload\s*\(/;

export const lifecyclePhaserScenePreloadRule: GameRule = {
  ruleId: 'lifecycle-phaser-scene-preload',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const jsContent = readAllJsContent(submitDir);
    if (!jsContent) return [{ ruleId: 'lifecycle-phaser-scene-preload', level: 'error', message: '缺少 preload() 方法定义。phaser-mobile 游戏至少一个 Scene MUST 定义 preload() 加载资源。' }];

    if (!RE_PRELOAD.test(jsContent)) {
      return [{ ruleId: 'lifecycle-phaser-scene-preload', level: 'error', message: '缺少 preload() 方法定义。phaser-mobile 游戏至少一个 Scene MUST 定义 preload() 加载资源。' }];
    }
    return [];
  },
};
