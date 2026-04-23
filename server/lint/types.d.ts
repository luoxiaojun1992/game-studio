/**
 * Lint Framework 类型定义
 *
 * 可扩展的静态检查框架核心接口。
 * 新增检查器只需实现 LintChecker 接口，注册到 LintRunner 即可。
 */
/** 单条 lint 检查结果 */
export interface LintIssue {
    /** 规则唯一标识（如 'html-doctype', 'js-eval', 'sensitive-word'） */
    ruleId: string;
    /** 问题级别：error = 阻断提交，warn = 仅记录日志 */
    level: 'error' | 'warn';
    /** 中文错误描述 */
    message: string;
    /** 可选：问题所在行号 */
    line?: number;
    /** 产生此 issue 的检查器 ID */
    checkerId: string;
}
/** Lint 检查上下文信息 */
export interface LintContext {
    /** 文件名（如 'snake.html'） */
    fileName?: string;
    /** 项目 ID */
    projectId?: string;
    /**
     * 原始 ZIP Buffer（ZIP 打包模式专用）
     * 当 lintZipBuffer 传入时，sonarqube checker 可直接上传此 buffer，
     * 避免"提取 HTML → 重新打包"的往返开销。
     */
    zipBuffer?: Buffer;
    /** 扩展字段，供各 checker 自由使用 */
    [key: string]: unknown;
}
/** Lint 检查聚合结果 */
export interface LintResult {
    /** 是否通过（无 error 级 issue 即为 true） */
    passed: boolean;
    /** 所有 issue（含 error + warn） */
    issues: LintIssue[];
    /** 仅 error 级 issue */
    errors: LintIssue[];
    /** 仅 warn 级 issue */
    warnings: LintIssue[];
    /** 人类可读的汇总文本（用于 tool 调用失败返回） */
    summary: string;
}
/**
 * Lint 检查器接口
 *
 * 每个检查器必须实现此接口，通过 LintRunner.register() 注册后即可自动参与检查流程。
 * 实现示例：
 * ```typescript
 * export const myChecker: LintChecker = {
 *   id: 'my-checker',
 *   name: '我的检查器',
 *   description: '描述',
 *   check(content, context) { return [...issues]; },
 * };
 * ```
 */
export interface LintChecker {
    /** 检查器唯一标识（如 'html-structure', 'js-security', 'sensitive-words'） */
    readonly id: string;
    /** 检查器显示名称 */
    readonly name: string;
    /** 检查器功能描述 */
    readonly description: string;
    /**
     * 执行检查逻辑
     * @param content 待检查的内容字符串
     * @param context 可选上下文信息（文件名、项目ID等）
     * @returns 发现的 issue 列表（空数组表示无问题）
     */
    check(content: string, context?: LintContext): LintIssue[] | Promise<LintIssue[]>;
}
