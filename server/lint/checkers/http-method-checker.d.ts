/**
 * HTTP 方法安全检查器
 *
 * 检测 HTML 内容中的 JavaScript fetch / XMLHttpRequest 调用，
 * 仅允许 GET 和 OPTIONS 方法，屏蔽其他所有 HTTP 方法（POST/PUT/DELETE/PATCH 等）。
 *
 * 规则为 error 级别，检测到即阻断提交。
 */
import type { LintChecker } from '../types.js';
export declare const httpMethodChecker: LintChecker;
