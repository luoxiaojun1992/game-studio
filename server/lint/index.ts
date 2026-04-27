/**
 * Lint Framework 核心模块
 *
 * 可扩展的静态检查运行时。
 * 通过 register() 注册 LintChecker，run() 执行检查并聚合结果。
 *
 * 使用方式：
 * ```typescript
 * import { createLintRunner, lintGameContent } from './index.js';
 *
 * // 方式一：直接使用便捷函数（内置所有默认 checker）
 * const result = lintGameContent(htmlContent);
 *
 * // 方式二：自定义 runner
 * const runner = createLintRunner();
 * runner.register(myCustomChecker);
 * runner.disable(['js-security']); // 禁用某个 checker
 * const result = runner.run(content);
 * ```
 */

import type { LintChecker, LintContext, LintIssue, LintResult } from './types.js';
export type { LintIssue } from './types.js';
import { builtInCheckers } from './checkers/index.js';

/**
 * 创建 LintRunner 实例
 */
export function createLintRunner(): LintRunner {
  return new LintRunner();
}

/**
 * 使用所有内置检查器执行 lint 检查（便捷入口函数）
 *
 * @param htmlContent 待检查的 HTML 内容字符串
 * @param context 可选上下文信息
 * @returns lint 检查结果
 */
export async function lintGameContent(htmlContent: string, context?: LintContext): Promise<LintResult> {
  const runner = createLintRunner();
  runner.registerAll(builtInCheckers);
  return runner.run(htmlContent, context);
}

/**
 * Lint 检查运行时
 *
 * 管理已注册的检查器列表，支持：
 * - register / registerAll: 注册检查器
 * - disable / enable: 按 ID 禁用/启用检查器
 * - run: 执行所有启用中的检查器并返回聚合结果
 */
export class LintRunner {
  private checkers: Map<string, LintChecker> = new Map();
  private disabledIds: Set<string> = new Set();

  /**
   * 注册一个检查器
   * @returns this（支持链式调用）
   */
  register(checker: LintChecker): this {
    if (this.checkers.has(checker.id)) {
      throw new Error(`[LintFramework] 检查器 "${checker.id}" 已注册，不能重复注册`);
    }
    this.checkers.set(checker.id, checker);
    return this;
  }

  /**
   * 批量注册检查器
   * @returns this（支持链式调用）
   */
  registerAll(checkers: LintChecker[]): this {
    for (const checker of checkers) {
      this.register(checker);
    }
    return this;
  }

  /**
   * 按 ID 禁用指定检查器（不删除，只是跳过执行）
   * @returns this（支持链式调用）
   */
  disable(ids: string[]): this {
    for (const id of ids) {
      if (!this.checkers.has(id)) {
        console.warn(`[LintFramework] 尝试禁用不存在的检查器: ${id}`);
      }
      this.disabledIds.add(id);
    }
    return this;
  }

  /**
   * 按 ID 启用之前被禁用的检查器
   * @returns this（支持链式调用）
   */
  enable(ids: string[]): this {
    for (const id of ids) {
      this.disabledIds.delete(id);
    }
    return this;
  }

  /**
   * 执行所有已启用的检查器，聚合结果后返回
   *
   * @param content 待检查的内容
   * @param context 可选上下文信息
   * @returns 聚合后的 lint 结果
   */
  async run(content: string, context?: LintContext): Promise<LintResult> {
    const allIssues: LintIssue[] = [];

    for (const [id, checker] of this.checkers) {
      // 跳过被禁用的检查器
      if (this.disabledIds.has(id)) continue;

      try {
        const result = checker.check(content, context);
        const issues = result instanceof Promise ? await result : result;
        allIssues.push(...issues);
      } catch (error: any) {
        // 检查器本身抛出异常 → 记录为 error 级 issue
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
    };
  }
}

/**
 * 构建人类可读的结果汇总文本
 */
function buildSummary(errors: LintIssue[], warnings: LintIssue[]): string {
  const lines: string[] = [];

  if (errors.length > 0) {
    lines.push('❌ HTML lint 检查未通过：');
    for (const e of errors) {
      lines.push(`  [${e.ruleId}] ${e.message}`);
    }
  }

  if (warnings.length > 0) {
    if (errors.length > 0) lines.push('');
    lines.push(`⚠️ 警告 (${warnings.length} 条)：`);
    for (const w of warnings) {
      lines.push(`  [${w.ruleId}] ${w.message}`);
    }
  }

  return lines.join('\n') || '✅ lint 检查通过';
}

/**
 * 对 ZIP 包内的所有 HTML 文件执行 lint 检查
 * 遍历所有 .html/.htm 文件，发现第一个 error 时立即返回
 *
 * @param zipBuffer ZIP 文件内容 Buffer
 * @param context 可选上下文信息
 * @returns lint 检查结果
 */
export async function lintZipBuffer(zipBuffer: Buffer, context?: LintContext): Promise<LintResult> {
  const { default: unzipper } = await import('unzipper');

  const zip = await unzipper.Open.buffer(zipBuffer);
  const htmlFiles = zip.files.filter((f: any) =>
    !f.dir && /\.(html?|htm)$/i.test(f.path)
  );

  if (htmlFiles.length === 0) {
    return {
      passed: true,
      issues: [],
      errors: [],
      warnings: [],
      summary: '✅ lint 检查通过（ZIP 内无 HTML 文件）',
    };
  }

  const runner = createLintRunner();
  runner.registerAll(builtInCheckers);

  // 按文件逐一检查，发现第一个 error 即停
  for (const file of htmlFiles) {
    const content = await file.buffer();
    const text = content.toString('utf-8');
    // 统一传递 context（包含 zipBuffer），供 sonarqubeChecker 直接扫描原 ZIP
    const checkerContext = { ...context, fileName: file.path };
    const result = await runner.run(text, checkerContext);

    if (!result.passed) {
      // 第一个 error 文件，直接返回
      return {
        passed: false,
        issues: result.issues,
        errors: result.errors,
        warnings: result.warnings,
        summary: result.summary.replace('❌', `❌ [${file.path}] `),
      };
    }

    // 无 error 但有 warning，继续检查下一个文件
    if (result.warnings.length > 0) {
      // 累积 warning，但不阻断
      for (const w of result.warnings) {
        w.message = `[${file.path}] ${w.message}`;
      }
    }
  }

  // 所有文件均通过
  return {
    passed: true,
    issues: [],
    errors: [],
    warnings: [],
    summary: '✅ lint 检查通过',
  };
}
