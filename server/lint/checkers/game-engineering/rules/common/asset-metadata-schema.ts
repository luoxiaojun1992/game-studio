/**
 * asset-metadata-schema: metadata.json MUST 是合法 JSON 且包含所有必填字段
 */
import type { GameRule, CheckerResult } from '../types.js';
import { readMetadataJson } from './utils.js';
import { isValidGameType } from '../../../../../db.js';

interface FieldCheck {
  required: boolean;
  validate: (v: unknown) => string | null; // null = pass, string = error message
}

const fieldChecks: Record<string, FieldCheck> = {
  'title': {
    required: true,
    validate: (v) => (typeof v === 'string' && v.length > 0) ? null : 'title 必须是非空字符串',
  },
  'version': {
    required: true,
    validate: (v) => (typeof v === 'string' && v.length > 0) ? null : 'version 必须是非空字符串',
  },
  'game_type': {
    required: true,
    validate: (v) => {
      if (typeof v !== 'string' || v.length === 0) return 'game_type 必须是非空字符串';
      if (!isValidGameType(v)) return `game_type 值 "${v}" 未注册。请先调用 get_game_types 确认支持的类型。`;
      return null;
    },
  },
  'resolution': {
    required: true,
    validate: (v) => {
      if (typeof v !== 'object' || v === null) return 'resolution 必须是对象';
      const r = v as Record<string, unknown>;
      if (typeof r.width !== 'number' || typeof r.height !== 'number') return 'resolution 必须包含 width 和 height（均为数字）';
      return null;
    },
  },
  'orientation': {
    required: true,
    validate: (v) => (['landscape', 'portrait'].includes(v as string)) ? null : 'orientation 必须是 "landscape" 或 "portrait"',
  },
  'entry': {
    required: true,
    validate: (v) => (typeof v === 'string' && v.length > 0) ? null : 'entry 必须是非空字符串',
  },
};

export const assetMetadataSchemaRule: GameRule = {
  ruleId: 'asset-metadata-schema',
  level: 'error',
  appliesTo: () => true,
  check(submitDir: string): CheckerResult[] {
    const meta = readMetadataJson(submitDir);
    if (meta === null) return []; // 由 asset-metadata-exists 处理

    const results: CheckerResult[] = [];
    const missingFields: string[] = [];

    for (const [field, check] of Object.entries(fieldChecks)) {
      const value = meta[field];
      if (check.required && (value === undefined || value === null)) {
        missingFields.push(field);
        continue;
      }
      if (value !== undefined && value !== null) {
        const err = check.validate(value);
        if (err) {
          results.push({ ruleId: 'asset-metadata-schema', level: 'error', message: `metadata.json 字段 "${field}" 类型错误：${err}` });
        }
      }
    }

    if (missingFields.length > 0) {
      results.push({ ruleId: 'asset-metadata-schema', level: 'error', message: `metadata.json 缺少必填字段：${missingFields.join('、')}。` });
    }

    return results;
  },
};
