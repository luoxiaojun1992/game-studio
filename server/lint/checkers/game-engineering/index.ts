/**
 * Game Engineering Checker
 *
 * 统一的 Lint 检查器，对游戏成品进行工程规范静态校验。
 * 按 game_type 自动选择适用的规则集，规则按目录分类：
 * - rules/common/ → 通用规则（所有 game_type 均运行）
 * - rules/h5/ → H5 特有规则（仅 game_type === "h5" 时运行）
 *
 * 文件路径约定：所有游戏类型使用 dist/ 为提交前缀
 * - HTML 规则读取 submitDir/dist/index.html
 * - 元信息规则读取 submitDir/dist/metadata.json
 * - H5 manifest 规则读取 submitDir/dist/assets/manifest.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { LintChecker, LintIssue, LintContext } from '../../types.js';
import type { GameRule, CheckerResult } from './rules/types.js';
import { htmlDoctypeRule } from './rules/common/html-doctype.js';
import { htmlRootRule } from './rules/common/html-root.js';
import { htmlHeadRule } from './rules/common/html-head.js';
import { htmlBodyRule } from './rules/common/html-body.js';
import { htmlCharsetRule } from './rules/common/html-charset.js';
import { htmlBodyNotEmptyRule } from './rules/common/html-body-not-empty.js';
import { assetMetadataExistsRule } from './rules/common/asset-metadata-exists.js';
import { assetMetadataSchemaRule } from './rules/common/asset-metadata-schema.js';
import { lifecycleExportsRule } from './rules/h5/lifecycle-exports.js';
import { lifecycleWindowGlobalRule } from './rules/h5/lifecycle-window-global.js';
import { lifecycleScriptTagRule } from './rules/h5/lifecycle-script-tag.js';
import { assetManifestExistsRule } from './rules/h5/asset-manifest-exists.js';
import { assetManifestSchemaRule } from './rules/h5/asset-manifest-schema.js';
import { assetResourceRelativePathRule } from './rules/h5/asset-resource-relative-path.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);
const _gets = () => new Date().toISOString();

class GameEngineeringCheckerImpl implements LintChecker {
  readonly id = 'game-engineering';
  readonly name = '游戏工程规范检查器';
  readonly description = '验证游戏成品是否符合工程规范（HTML结构、元信息、生命周期契约等）';

  private rules: GameRule[] = [];
  private rulesLoaded = false;

  constructor() {
    this._initRules();
  }

  /** 初始化规则，按目录分类注册 */
  private _initRules(): void {
    // 公共规则（全部 game_type 均运行）
    this._register(htmlDoctypeRule, 'common');
    this._register(htmlRootRule, 'common');
    this._register(htmlHeadRule, 'common');
    this._register(htmlBodyRule, 'common');
    this._register(htmlCharsetRule, 'common');
    this._register(htmlBodyNotEmptyRule, 'common');
    this._register(assetMetadataExistsRule, 'common');
    this._register(assetMetadataSchemaRule, 'common');

    // H5 特有规则（仅 game_type === "h5" 时运行）
    this._register(lifecycleExportsRule, 'h5');
    this._register(lifecycleWindowGlobalRule, 'h5');
    this._register(lifecycleScriptTagRule, 'h5');
    this._register(assetManifestExistsRule, 'h5');
    this._register(assetManifestSchemaRule, 'h5');
    this._register(assetResourceRelativePathRule, 'h5');

    this.rulesLoaded = true;
  }

  /** 注册一条规则，dirName 决定 appliesTo 行为 */
  private _register(rule: GameRule, dirName: string): void {
    if (dirName !== 'common') {
      const originalAppliesTo = rule.appliesTo.bind(rule);
      rule.appliesTo = (gameType: string) => gameType === dirName && originalAppliesTo(gameType);
    }
    this.rules.push(rule);
  }

  /** LintChecker 接口实现，接收 submitDir 上下文 */
  async check(content: string, context: LintContext): Promise<LintIssue[]> {
    const submitDir = context.submitDir;
    console.error(`[GameEngineering checker] ${_gets()} check START submitDir=${submitDir}`);
    if (!submitDir || !fs.existsSync(submitDir)) {
      console.error(`[GameEngineering checker] ${_gets()} check SKIP submitDir not found`);
      return [{
        ruleId: 'checker-fatal',
        level: 'error' as const,
        message: '未提供有效的提交产物目录（submitDir）。',
        checkerId: 'game-engineering',
      }];
    }
    const issues = this._runCheck(submitDir);
    console.error(`[GameEngineering checker] ${_gets()} check DONE submitDir=${submitDir} issues=${issues.length}`);
    return issues;
  }

  /** 执行检查 */
  private _runCheck(submitDir: string): LintIssue[] {
    // 读取 game_type
    const gameType = this._readGameType(submitDir);
    console.error(`[GameEngineering checker] ${_gets()} _runCheck gameType=${gameType}`);
    if (!gameType) {
      console.error(`[GameEngineering checker] ${_gets()} _runCheck FAIL no game_type found`);
      return [{
        ruleId: 'asset-metadata-exists',
        level: 'error' as const,
        message: '缺少 metadata.json 或 game_type 字段。',
        checkerId: 'game-engineering',
      }];
    }

    // 运行适用规则
    const allResults: CheckerResult[] = [];
    let rulesRun = 0;
    let rulesSkipped = 0;
    for (const rule of this.rules) {
      if (!rule.appliesTo(gameType)) { rulesSkipped++; continue; }
      rulesRun++;
      try {
        const results = rule.check(submitDir);
        if (results.length > 0) {
          console.error(`[GameEngineering checker] ${_gets()} rule=${rule.ruleId} issues=${results.length} first=${results[0].message}`);
        }
        allResults.push(...results);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[GameEngineering checker] ${_gets()} rule=${rule.ruleId} ERROR ${errMsg}`);
        allResults.push({
          ruleId: rule.ruleId,
          level: 'error',
          message: `规则执行异常：${errMsg}`,
        });
      }
    }

    console.error(`[GameEngineering checker] ${_gets()} _runCheck DONE rulesRun=${rulesRun} rulesSkipped=${rulesSkipped} totalIssues=${allResults.length}`);

    // 映射为 LintIssue[]
    return allResults.map(r => ({
      ruleId: r.ruleId,
      level: r.level === 'error' ? 'error' as const : 'warn' as const,
      message: r.message,
      line: r.line,
      checkerId: 'game-engineering' as const,
    }));
  }

  /** 从 submitDir/dist/metadata.json 读取 game_type */
  private _readGameType(submitDir: string): string | null {
    const metaPath = path.join(submitDir, 'dist', 'metadata.json');
    try {
      if (!fs.existsSync(metaPath)) return null;
      const raw = fs.readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(raw);
      return typeof meta.game_type === 'string' && meta.game_type.length > 0 ? meta.game_type : null;
    } catch {
      return null;
    }
  }
}

/**
 * Game Engineering Checker 单例
 */
export const gameEngineeringChecker: LintChecker = new GameEngineeringCheckerImpl();
