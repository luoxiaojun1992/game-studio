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

  registerAll(checks: LintChecker[]): void {
    for (const checker of checks) {
      this.checkers.set(checker.id, checker);
    }
  }
}

/**
 * 创建 LintRunner 实例
 */
function createLintRunner(): LintRunner {
  return new LintRunner();
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

const _lts = () => new Date().toISOString();

/**
 * 使用所有内置检查器执行 lint 检查（统一入口函数）
 *
 * Checker 通过 context.submitDir 获取游戏成品目录路径，自行决定处理方式：
 * - SonarQube checker：自行从 submitDir 打包 ZIP 后调用 scanner 微服务
 * - GameEngineeringChecker：直接读取 submitDir/dist/* 文件进行规则校验
 *
 * @param zipBuffer ZIP 文件内容 Buffer（已废弃，仅为兼容保留签名）
 * @param context 检查上下文，必须包含 submitDir 字段
 * @returns lint 检查结果
 */
export async function lintGameArtifact(zipBuffer: Buffer, context?: LintContext): Promise<LintResult> {
  const runner = createLintRunner();
  runner.registerAll(builtInCheckers);
  console.error(`[LintFramework] ${_lts()} lintGameArtifact start zipSize=${zipBuffer.length} checkers=${builtInCheckers.length}`);

  const allIssues: LintIssue[] = [];
  const extraPayloads: Record<string, unknown> = {};
  const enrichedContext: LintContext = { ...context, __extraPayloads: extraPayloads };

  let checkerIndex = 0;
  for (const [id, checker] of runner['checkers']) {
    checkerIndex++;
    console.error(`[LintFramework] ${_lts()} running checker ${checkerIndex}/${builtInCheckers.length} id=${id} name=${checker.name}`);
    if (runner['disabledIds'].has(id)) {
      console.error(`[LintFramework] ${_lts()} checker ${id} is disabled, skipping`);
      continue;
    }
    try {
      const result = checker.check(enrichedContext);
      const issues = result instanceof Promise ? await result : result;
      allIssues.push(...issues);
      console.error(`[LintFramework] ${_lts()} checker ${id} done issues=${issues.length}`);
    } catch (error: any) {
      console.error(`[LintFramework] ${_lts()} checker ${id} error: ${error?.message || String(error)}`);
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
  console.error(`[LintFramework] ${_lts()} lintGameArtifact done totalIssues=${allIssues.length} errors=${errors.length} warnings=${warnings.length} passed=${errors.length === 0}`);

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
