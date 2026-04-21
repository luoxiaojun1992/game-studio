/**
 * JS 安全检查器
 *
 * 对 HTML 内容中的 JavaScript 代码进行静态安全扫描，
 * 检测 eval、Function() 构造、javascript: 协议、innerHTML 写入等高风险模式。
 *
 * 所有规则均为 warn 级别（记录日志但不阻断提交），
 * 因为游戏可能合法使用这些特性（如 eval 解析游戏数据、innerHTML 更新 DOM 等）。
 */
import type { LintChecker } from '../types.js';
export declare const jsSecurityChecker: LintChecker;
