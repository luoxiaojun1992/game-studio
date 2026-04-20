/**
 * 内置 Lint 检查器注册表
 *
 * 统一注册所有内置检查器，供 LintRunner 使用。
 * 新增内置检查器时只需在此文件中导入并添加到数组即可。
 */
import type { LintChecker } from '../types.js';
/**
 * 所有内置检查器的列表
 *
 * 在 lintGameContent() 便捷函数中被自动注册到 LintRunner。
 * 如需自定义组合，可通过 createLintRunner().registerAll(...) 手动选择。
 */
export declare const builtInCheckers: LintChecker[];
