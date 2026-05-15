/**
 * Lint Framework 核心模块
 *
 * 可扩展的静态检查运行时。
 * 通过 register() 注册 LintChecker，run() 执行检查并聚合结果。
 *
 * 使用方式：
 * ```typescript
 * import { lintGameArtifact } from './index.js';
 *
 * // 统一入口：lint 游戏成品 ZIP
 * const result = await lintGameArtifact(zipBuffer, context);
 * ```
 */

import type { LintChecker, LintContext, LintIssue, LintResult } from './types.js';
export type { LintIssue } from './types.js';
import { builtInCheckers } from './checkers/index.js';

/**
 * LintRunner — 检查器容器与运行时
 */
class LintRunner {
  private checkers = new Map<string, LintChecker>();
  private disabledIds = new Set<string>();

  registerAll(checks: Array<{ id: string; checker: LintChecker }>): void {
    for (const { id, checker } of checks) {
      this.checkers.set(id, checker);
    }
  }
}

/**
 * 构建摘要文本
 */
function buildSummary(errors: LintIssue[], warnings: LintIssue[]): string {
  const parts: string[] = [];
  if (errors.length > 0) parts.push(`${errors.length} 个错误`);
  if (warnings.length > 0) parts.push(`${warnings.length} 个警告`);
  return parts.join('，') || '无问题';
}

/**
 * 使用所有内置检查器执行 lint 检查（统一入口函数）
 *
 * 传入 ZIP Buffer，由具体 checker 自行决定是否解压。
 *
 * @param zipBuffer ZIP 文件内容 Buffer
 * @param context 可选上下文信息
 * @returns lint 检查结果
 */
export async function lintGameArtifact(zipBuffer: Buffer, context?: LintContext): Promise<LintResult> {
  const runner = createLintRunner();
  runner.registerAll(builtInCheckers);

  const allIssues: LintIssue[] = [];
  const extraPayloads: Record<string, unknown> = {};
  const enrichedContext: LintContext = { ...context, __extraPayloads: extraPayloads, zipBuffer };

  for (const [id, checker] of runner['checkers']) {
    if (runner['disabledIds'].has(id)) continue;
    try {
      const result = checker.check('', enrichedContext);
      const issues = result instanceof Promise ? await result : result;
      allIssues.push(...issues);
    } catch (error: any) {
      allIssues.push({
        ruleId: `${id}-internal-error`,
        level: 'error',
        message: `检查器 [${checker.name}] 执行异常: ${error?.message || String(error)}`,
        checkerId: 'lint-framework',
      });
    }
  }

  const errors = allIssues.filter(i => i.level === 'error');
  const warnings = allIssues.filter(i => i.level === 'warn');

  return {
    passed: errors.length === 0,
    issues: allIssues,
    errors,
    warnings,
    summary: buildSummary(errors, warnings),
    extraPayloads: Object.keys(extraPayloads).length > 0 ? extraPayloads : undefined,
  };
}

/**
 * @deprecated 使用 lintGameArtifact 替代
 */
export const lintGameContent = lintGameArtifact;

/**
 * @deprecated 使用 lintGameArtifact 替代
 */
export const lintZipBuffer = lintGameArtifact;
