/**
 * Game Engineering Checker 规则类型定义
 *
 * GameRule: 规则接口，每条规则需实现 check(submitDir) 方法
 * CheckerResult: 规则检查结果，由主 checker 统一映射为 LintIssue
 */

export interface CheckerResult {
  /** 全局唯一规则 ID，如 "html-doctype" */
  ruleId: string;
  /** 问题级别 */
  level: 'error' | 'warning' | 'info';
  /** 人类可读的错误/提示消息 */
  message: string;
  /** 可选行号（1-based），对应 HTML 或 JSON 文件 */
  line?: number;
}

export interface GameRule {
  /** 规则唯一 ID */
  ruleId: string;
  /** 默认 level */
  level: 'error' | 'warning' | 'info';
  /** 判定是否适用于当前游戏类型 */
  appliesTo(gameType: string): boolean;
  /** 执行检查，传入提交产物目录路径 */
  check(submitDir: string): CheckerResult[];
}
