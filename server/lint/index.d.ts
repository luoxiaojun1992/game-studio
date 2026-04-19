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
import type { LintChecker, LintContext, LintResult } from './types.js';
/**
 * 创建 LintRunner 实例
 */
export declare function createLintRunner(): LintRunner;
/**
 * 使用所有内置检查器执行 lint 检查（便捷入口函数）
 *
 * @param htmlContent 待检查的 HTML 内容字符串
 * @param context 可选上下文信息
 * @returns lint 检查结果
 */
export declare function lintGameContent(htmlContent: string, context?: LintContext): LintResult;
/**
 * Lint 检查运行时
 *
 * 管理已注册的检查器列表，支持：
 * - register / registerAll: 注册检查器
 * - disable / enable: 按 ID 禁用/启用检查器
 * - run: 执行所有启用中的检查器并返回聚合结果
 */
export declare class LintRunner {
    private checkers;
    private disabledIds;
    /**
     * 注册一个检查器
     * @returns this（支持链式调用）
     */
    register(checker: LintChecker): this;
    /**
     * 批量注册检查器
     * @returns this（支持链式调用）
     */
    registerAll(checkers: LintChecker[]): this;
    /**
     * 按 ID 禁用指定检查器（不删除，只是跳过执行）
     * @returns this（支持链式调用）
     */
    disable(ids: string[]): this;
    /**
     * 按 ID 启用之前被禁用的检查器
     * @returns this（支持链式调用）
     */
    enable(ids: string[]): this;
    /**
     * 执行所有已启用的检查器，聚合结果后返回
     *
     * @param content 待检查的内容
     * @param context 可选上下文信息
     * @returns 聚合后的 lint 结果
     */
    run(content: string, context?: LintContext): LintResult;
}
