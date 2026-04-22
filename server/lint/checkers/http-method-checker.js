/**
 * HTTP 方法安全检查器
 *
 * 检测 HTML 内容中的 JavaScript fetch / XMLHttpRequest 调用，
 * 仅允许 GET 和 OPTIONS 方法，屏蔽其他所有 HTTP 方法（POST/PUT/DELETE/PATCH 等）。
 *
 * 规则为 error 级别，检测到即阻断提交。
 */
// ====== 预编译正则 ======
/**
 * fetch(url, { method: "POST" }) 或 fetch("url", { method: 'POST' })
 * 匹配 fetch 调用中的 method 字段
 */
const RE_FETCH_METHOD = /fetch\s*\(\s*[^)]+\s*,\s*\{[^}]*?\bmethod\s*\s*:\s*["']([^"']+)["']/gi;
/**
 * new XMLHttpRequest() + .open("POST", url) 或 .open('POST', url)
 * 匹配 XMLHttpRequest.open 调用中的 method 参数
 */
const RE_XHR_METHOD = /\.open\s*\(\s*["']([^"']+)["']\s*,/gi;
/**
 * fetch(url) 或 fetch(url, options) — 未指定 method，默认 GET，放行
 */
/**
 * 直接写死 method 字符串字面量的方式（另一种少见写法）
 * open("POST", ...) 已由 RE_XHR_METHOD 覆盖
 */
// ====== 辅助函数 ======
const ALLOWED_METHODS = new Set(['get', 'options', 'head', 'connect', 'trace']);
const FORBIDDEN_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];
function buildMessage(method) {
    return `检测到非安全 HTTP 方法 [${method}]。游戏成品仅允许 GET/OPTIONS 请求，禁止向外部接口发送 POST/PUT/DELETE/PATCH 等操作。建议检查是否使用了游戏数据接口，如需服务端交互请通过 GET 参数或预定义接口实现。`;
}
function findHttpMethods(content, regex, ruleId, checkerId) {
    const issues = [];
    const lines = content.split('\n');
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null && issues.length < 10) {
        const method = match[1].toUpperCase();
        if (!ALLOWED_METHODS.has(method)) {
            // 计算行号
            const pos = match.index;
            let lineNum = 1;
            let charCount = 0;
            for (const line of lines) {
                charCount += line.length + 1;
                if (charCount > pos)
                    break;
                lineNum++;
            }
            issues.push({
                ruleId,
                level: 'error',
                message: buildMessage(method),
                line: lineNum,
                checkerId,
            });
        }
    }
    return issues;
}
// ====== 检查器定义 ======
export const httpMethodChecker = {
    id: 'http-method',
    name: 'HTTP 方法安全检查',
    description: '检测 fetch / XMLHttpRequest 中的非 GET/OPTIONS HTTP 方法，仅允许 GET 和 OPTIONS，屏蔽 POST/PUT/DELETE/PATCH 等',
    check(content, _context) {
        const issues = [];
        const cid = httpMethodChecker.id;
        // 1. fetch() 中的 method 字段
        issues.push(...findHttpMethods(content, RE_FETCH_METHOD, 'http-fetch-method', cid));
        // 2. XMLHttpRequest.open() 中的 method 参数
        issues.push(...findHttpMethods(content, RE_XHR_METHOD, 'http-xhr-method', cid));
        return issues;
    },
};
