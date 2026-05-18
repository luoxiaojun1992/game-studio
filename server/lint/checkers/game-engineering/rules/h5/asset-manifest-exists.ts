/**
 * asset-manifest-exists: assets/manifest.json MUST 存在于提交产物目录
 */
import type { GameRule, CheckerResult } from '../types.js';
import fs from 'fs';
import path from 'path';

export const assetManifestExistsRule: GameRule = {
  ruleId: 'asset-manifest-exists',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const manifestPath = path.join(submitDir, 'dist', 'assets', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return [{ ruleId: 'asset-manifest-exists', level: 'error', message: '缺少 assets/manifest.json。' }];
    }
    return [];
  },
};
