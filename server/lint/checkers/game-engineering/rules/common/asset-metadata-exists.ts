/**
 * asset-metadata-exists: metadata.json MUST 存在于提交产物 dist/ 目录
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readMetadataJson } from './utils.js';

export const assetMetadataExistsRule: GameRule = {
  ruleId: 'asset-metadata-exists',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const meta = readMetadataJson(submitDir);
    if (meta === null) {
      return [{ ruleId: 'asset-metadata-exists', level: 'error', message: '缺少 metadata.json。' }];
    }
    return [];
  },
};
