/**
 * asset-manifest-schema: manifest.json MUST 是合法 JSON 且包含 resources 数组
 */
import type { GameRule, CheckerResult } from '../types.js';
import fs from 'fs';
import path from 'path';

export const assetManifestSchemaRule: GameRule = {
  ruleId: 'asset-manifest-schema',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const manifestPath = path.join(submitDir, 'dist', 'assets', 'manifest.json');
    if (!fs.existsSync(manifestPath)) return []; // 由 asset-manifest-exists 处理

    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      return [{ ruleId: 'asset-manifest-schema', level: 'error', message: 'assets/manifest.json 不是合法 JSON 格式。' }];
    }

    const manifest = data as Record<string, unknown>;
    if (!Array.isArray(manifest.resources)) {
      return [{ ruleId: 'asset-manifest-schema', level: 'error', message: 'assets/manifest.json 缺少 resources 数组。' }];
    }

    const results: CheckerResult[] = [];
    for (let i = 0; i < manifest.resources.length; i++) {
      const item = manifest.resources[i];
      if (typeof item.path !== 'string' || item.path.length === 0) {
        results.push({ ruleId: 'asset-manifest-schema', level: 'error', message: `assets/manifest.json resources[${i}] 缺少 "path"。` });
      }
      if (typeof item.type !== 'string' || item.type.length === 0) {
        results.push({ ruleId: 'asset-manifest-schema', level: 'error', message: `assets/manifest.json resources[${i}] 缺少 "type"。` });
      }
    }
    return results;
  },
};
