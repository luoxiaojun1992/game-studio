/**
 * lifecycle-phaser-game: 游戏脚本 MUST 创建 new Phaser.Game() 实例
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readAllJsContent } from '../common/utils.js';

const RE_PHASER_GAME = /new\s+Phaser\s*\.\s*Game\s*\(/;

export const lifecyclePhaserGameRule: GameRule = {
  ruleId: 'lifecycle-phaser-game',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const jsContent = readAllJsContent(submitDir);
    if (!jsContent) return [{ ruleId: 'lifecycle-phaser-game', level: 'error', message: '缺少 new Phaser.Game() 实例创建。phaser-mobile 游戏 MUST 通过 new Phaser.Game(config) 启动。' }];

    if (!RE_PHASER_GAME.test(jsContent)) {
      return [{ ruleId: 'lifecycle-phaser-game', level: 'error', message: '缺少 new Phaser.Game() 实例创建。phaser-mobile 游戏 MUST 通过 new Phaser.Game(config) 启动。' }];
    }
    return [];
  },
};
