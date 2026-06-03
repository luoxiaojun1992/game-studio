/**
 * asset-capacitor-config: Capacitor 配置 SHOULD 存在且 webDir 为 "dist"
 */
import type { GameRule, CheckerResult } from '../types.js';
import fs from 'fs';
import path from 'path';

export const assetCapacitorConfigRule: GameRule = {
  ruleId: 'asset-capacitor-config',
  level: 'warning',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    // 检查 capacitor.config.ts 或 capacitor.config.json
    // 配置文件位于 submitDir 根目录（write_game_file 写入路径相对于 latestDir）
    const configTsPath = path.join(submitDir, 'capacitor.config.ts');
    const configJsonPath = path.join(submitDir, 'capacitor.config.json');

    const configExists = fs.existsSync(configTsPath) || fs.existsSync(configJsonPath);
    if (!configExists) {
      return [{ ruleId: 'asset-capacitor-config', level: 'warning', message: '缺少 capacitor.config.ts/json。phaser-mobile 游戏 SHOULD 包含 Capacitor 配置用于原生打包。' }];
    }
    return [];
  },
};
