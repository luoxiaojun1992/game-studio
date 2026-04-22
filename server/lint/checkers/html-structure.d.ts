/**
 * HTML 结构检查器
 *
 * 检查单文件 HTML 游戏的结构完整性，包括 DOCTYPE、基本标签骨架、字符编码、body 非空等。
 * 所有规则均为 error 级别，任何一项不通过都会阻断提交。
 */
import type { LintChecker } from '../types.js';
export declare const htmlStructureChecker: LintChecker;
