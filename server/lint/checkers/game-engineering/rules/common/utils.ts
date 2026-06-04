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

/**
 * 读取提交产物目录下所有 .js 文件内容并合并
 * 用于 phaser-mobile 类型的生命周期规则检查
 * 统一路径：submitDir/dist/
 */
export function readAllJsContent(submitDir: string): string {
  const distDir = path.join(submitDir, 'dist');
  const contents: string[] = [];

  function walkDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          try {
            contents.push(fs.readFileSync(fullPath, 'utf-8'));
          } catch {
            // 跳过无法读取的文件
          }
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  walkDir(distDir);
  return contents.join('\n');
}
