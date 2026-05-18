/**
 * 游戏工程规则工具函数
 */
import fs from 'fs';
import path from 'path';

/**
 * 读取提交产物中的入口 HTML 文件
 * 统一路径：submitDir/dist/index.html
 */
export function readEntryHtml(submitDir: string): string | null {
  const htmlPath = path.join(submitDir, 'dist', 'index.html');
  try {
    if (!fs.existsSync(htmlPath)) return null;
    return fs.readFileSync(htmlPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 读取提交产物中的 metadata.json
 * 统一路径：submitDir/dist/metadata.json
 */
export function readMetadataJson(submitDir: string): Record<string, unknown> | null {
  const metaPath = path.join(submitDir, 'dist', 'metadata.json');
  try {
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}
