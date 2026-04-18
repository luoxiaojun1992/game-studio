/**
 * HTML 结构检查器
 *
 * 检查单文件 HTML 游戏的结构完整性，包括 DOCTYPE、基本标签骨架、字符编码、body 非空等。
 * 所有规则均为 error 级别，任何一项不通过都会阻断提交。
 */

import type { LintChecker, LintIssue, LintContext } from '../types.js';

// ====== 预编译正则 ======

/** 匹配 <!DOCTYPE html> （大小写不敏感） */
const RE_DOCTYPE = /<!DOCTYPE\s+html>/i;

/** 匹配 <html ... > 或 <html> */
const RE_HTML_TAG = /<html[\s>]/i;

/** 匹配 <head ... > 或 <head> */
const RE_HEAD_TAG = /<head[\s>]/i;

/** 匹配 <body ... > 或 <body> */
const RE_BODY_TAG = /<body[\s>]/i;

/** 匹配 <meta charset="utf-8"> 及其变体 */
const RE_CHARSET_META = /<meta\s[^>]*charset=["']?utf-8["']?/i;

/** 提取 body 内容（用于非空检查） */
const RE_EXTRACT_BODY = /<body[^]*?>([\s\S]*)<\/body>/i;

/** 去除 HTML 标签后的纯文本空白检查 */
const RE_STRIP_TAGS = /<[^>]+>/g;
const RE_WHITESPACE_ONLY = /^[\s\n\r\t]*$/;

// ====== 检查器定义 ======

export const htmlStructureChecker: LintChecker = {
  id: 'html-structure',
  name: 'HTML 结构检查',
  description: '检查 HTML 文档的基本结构完整性（DOCTYPE、骨架标签、编码声明、body 非空）',

  check(content: string, _context?: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];
    const cid = htmlStructureChecker.id;

    // 1. DOCTYPE 检查
    if (!RE_DOCTYPE.test(content)) {
      issues.push({
        ruleId: 'html-doctype',
        level: 'error',
        message: '缺少 DOCTYPE 声明。文件开头应包含 "<!DOCTYPE html>"',
        checkerId: cid,
      });
    }

    // 2. <html> 根标签
    if (!RE_HTML_TAG.test(content)) {
      issues.push({
        ruleId: 'html-root',
        level: 'error',
        message: '缺少 <html> 根标签。',
        checkerId: cid,
      });
    }

    // 3. <head> 标签
    if (!RE_HEAD_TAG.test(content)) {
      issues.push({
        ruleId: 'html-head',
        level: 'error',
        message: '缺少 <head> 标签。单文件 HTML 应包含 head 区域放置 meta 和 title。',
        checkerId: cid,
      });
    }

    // 4. <body> 标签
    if (!RE_BODY_TAG.test(content)) {
      issues.push({
        ruleId: 'html-body',
        level: 'error',
        message: '缺少 <body> 标签。游戏内容应在 body 中渲染。',
        checkerId: cid,
      });
    }

    // 5. 字符编码声明（仅在存在 <head> 时才要求）
    if (RE_HEAD_TAG.test(content) && !RE_CHARSET_META.test(content)) {
      issues.push({
        ruleId: 'html-charset',
        level: 'error',
        message: '缺少字符编码声明。应在 <head> 中添加 <meta charset="utf-8">。',
        checkerId: cid,
      });
    }

    // 6. body 非空检查（仅在存在 <body> 标签时才检查内部内容）
    if (RE_BODY_TAG.test(content)) {
      const bodyMatch = content.match(RE_EXTRACT_BODY);
      if (!bodyMatch || RE_WHITESPACE_ONLY.test(bodyMatch[1].replace(RE_STRIP_TAGS, ''))) {
        issues.push({
          ruleId: 'html-body-not-empty',
          level: 'error',
          message: '<body> 内容为空或仅含空白。游戏应有可见的游戏内容。',
          checkerId: cid,
        });
      }
    }

    return issues;
  },
};
