/**
 * JS 安全检查器
 *
 * 对 HTML 内容中的 JavaScript 代码进行静态安全扫描，
 * 检测 eval、Function() 构造、javascript: 协议、innerHTML 写入等高风险模式。
 *
 * 所有规则均为 warn 级别（记录日志但不阻断提交），
 * 因为游戏可能合法使用这些特性（如 eval 解析游戏数据、innerHTML 更新 DOM 等）。
 */
// ====== 预编译正则 ======
/** 匹配 eval( 调用 */
const RE_EVAL = /\beval\s*\(/gi;
/** 匹配 Function( 构造函数调用（new Function() 或直接 Function()） */
const RE_FUNCTION_CTOR = /(?:new\s+)?Function\s*\(/g;
/** 匹配 javascript: 协议 URL（在 href/src 属性中常见） */
const RE_JS_URL = /javascript\s*:/gi;
/** 匹配 innerHTML 赋值操作（= 或 += 后接 innerHTML） */
const RE_INNER_HTML_WRITE = /\.innerHTML\s*[\+]?=/g;
// ====== 辅助函数 ======
/**
 * 在内容中搜索匹配项，返回带行号的 issue 列表
 * @param content 原始文本
 * @param regex 全局正则（必须带 g flag）
 * @param ruleId 规则 ID
 * @param message 错误消息模板
 * @param checkerId 检查器 ID
 * @param level 问题级别
 * @returns issue 列表（最多返回前 5 条）
 */
function findMatches(content, regex, ruleId, message, checkerId, level = 'warn') {
    const issues = [];
    const lines = content.split('\n');
    // 重置 lastIndex（防止复用问题）
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null && issues.length < 5) {
        // 计算匹配位置所在行号（1-based）
        const pos = match.index;
        let lineNum = 1;
        let charCount = 0;
        for (const line of lines) {
            charCount += line.length + 1; // +1 for newline
            if (charCount > pos)
                break;
            lineNum++;
        }
        issues.push({ ruleId, level, message, line: lineNum, checkerId });
    }
    return issues;
}
// ====== 检查器定义 ======
export const jsSecurityChecker = {
    id: 'js-security',
    name: 'JS 安全检查',
    description: '检测 JavaScript 代码中的高风险模式（eval、Function()、javascript: 协议、innerHTML 写入）',
    check(content, _context) {
        const issues = [];
        const cid = jsSecurityChecker.id;
        // 1. eval() 检测
        issues.push(...findMatches(content, RE_EVAL, 'js-eval', '检测到 eval() 调用。eval 存在代码注入风险，建议使用更安全的替代方案（如 JSON.parse）。', cid));
        // 2. Function() 构造函数检测
        issues.push(...findMatches(content, RE_FUNCTION_CTOR, 'js-function-constructor', '检测到 Function() 构造函数调用。动态代码执行存在安全风险，建议避免使用。', cid));
        // 3. javascript: 协议 URL 检测
        issues.push(...findMatches(content, RE_JS_URL, 'js-js-url', '检测到 javascript: 协议 URL。可能存在 XSS 风险，建议使用事件监听替代。', cid));
        // 4. innerHTML 写入检测
        issues.push(...findMatches(content, RE_INNER_HTML_WRITE, 'js-inner-html-write', '检测到 innerHTML 赋值操作。若赋值内容来自用户输入，可能导致 XSS 攻击。建议使用 textContent 或 DOM API 替代。', cid));
        return issues;
    },
};
