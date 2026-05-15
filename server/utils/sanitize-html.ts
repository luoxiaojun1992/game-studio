/**
 * HTML 安全校验与清洗工具
 *
 * 用于 submit_game 和 DB 层的 description 字段校验。
 * validateHtmlSafe — 校验并报错
 * sanitizeHtml — 清洗并返回安全的 HTML
 */

import sanitizeHtmlLib from 'sanitize-html';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'a', 'span', 'div'];
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'],
};
const ALLOWED_SCHEMES = ['http', 'https'];

/** 校验错误详情 */
export interface ValidationError {
  message: string;
  detail?: string;
}

/**
 * 校验 HTML 内容是否安全。
 * 返回空数组表示通过；非空表示存在安全问题。
 */
export function validateHtmlSafe(html: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // 禁止 script 标签
  const scriptTagRegex = /<script[\s>]/i;
  if (scriptTagRegex.test(html)) {
    errors.push({ message: '禁止使用 <script> 标签', detail: 'description 中不允许包含 script 标签' });
  }

  // 禁止 on* 事件属性
  const eventAttrRegex = /\s+on\w+\s*=\s*["']/i;
  if (eventAttrRegex.test(html)) {
    errors.push({ message: '禁止使用 on* 事件属性（如 onclick、onload 等）' });
  }

  // 禁止 javascript: / data: / vbscript: / file: 协议
  const dangerousProtocolRegex = /(?:href|src)\s*=\s*["'](?:javascript|data|vbscript|file):/i;
  if (dangerousProtocolRegex.test(html)) {
    errors.push({ message: 'href/src 中禁止使用 javascript:、data:、vbscript:、file: 等危险协议' });
  }

  // 检查所有标签是否在允许列表内
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tagName = tagMatch[1].toLowerCase();
    if (!ALLOWED_TAGS.includes(tagName)) {
      errors.push({
        message: `禁止使用 <${tagName}> 标签`,
        detail: `允许的标签：${ALLOWED_TAGS.join(', ')}`,
      });
      break; // 每个非法标签只报一次
    }
  }

  // 检查 a 标签的 href 协议
  const hrefRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = hrefRegex.exec(html)) !== null) {
    const href = hrefMatch[1].toLowerCase();
    const hasValidScheme = ALLOWED_SCHEMES.some(scheme => href.startsWith(`${scheme}://`));
    if (!hasValidScheme) {
      errors.push({
        message: `a 标签 href 仅允许 http:// 和 https:// 协议`,
        detail: `检测到：${href}`,
      });
      break;
    }

    // 检查 target="_blank" 时必须有 rel="noopener noreferrer"
    const fullMatch = hrefMatch[0];
    const hasTargetBlank = /target\s*=\s*["']_blank["']/i.test(fullMatch);
    if (hasTargetBlank) {
      const relMatch = fullMatch.match(/rel\s*=\s*["']([^"']*)["']/i);
      const relValue = relMatch ? relMatch[1].toLowerCase() : '';
      if (!relValue.includes('noopener') || !relValue.includes('noreferrer')) {
        errors.push({
          message: 'target="_blank" 时必须同时设置 rel="noopener noreferrer"',
        });
        break;
      }
    }
  }

  return errors;
}

/**
 * 清洗 HTML，移除不安全的标签和属性。
 * 返回清洗后的安全 HTML 字符串。
 */
export function sanitizeHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: { a: ['http', 'https'] },
    // 不允许任何协议在非 a 标签的 href 上
    allowProtocolRelative: false,
    // 不允许任何标签设置 style
    allowedStyles: {},
    // 禁止 script 标签
    exclusiveFilter: (frame) => frame.tag === 'script',
    // 移除所有不在允许列表中的标签
    transformTags: {},
  });
}

/**
 * 最大 description 长度
 */
export const MAX_DESCRIPTION_LENGTH = 2000;
