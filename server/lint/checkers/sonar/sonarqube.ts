/**
 * SonarQube 代码质量扫描检查器
 *
 * 通过 scanner 微服务（SonarScanner CLI）对游戏内容进行静态质量分析。
 *
 * 工作流程（调用 scanner 微服务）：
 * 1. 将 ZIP 包 POST 到 /api/scans/{project_id}
 *    - 有 zipBuffer → 直接发送
 *    - 无 zipBuffer，有 content (HTML) → 打包为 html_content/<fileName> 发送
 *    - 无 zipBuffer，有 content + gameDirPath → 打包为 html_content/ + source/ 合并发送
 *    - 两者均无 → 跳过扫描
 * 2. 轮询 GET /api/scans/{project_id} 直到 done/error
 * 3. 调用 SonarQube REST API 拉取 issues
 * 4. scanner 微服务自动清理 ZIP 和 sources 目录
 *
 * 依赖：
 * - scanner 微服务（SCANNER_SERVICE_URL，默认 http://localhost:8081）
 * - SonarQube 服务（SONARQUBE_HOST）
 */

import { readdir } from 'fs/promises';
import { join } from 'path';
import yazl from 'yazl';
import { createInflate } from 'zlib';

import type { LintChecker, LintIssue, LintContext } from '../../types.js';
import { submitScan, pollScanStatus } from '../../../sonar-scanner-service.js';
import { globalTokenManager } from './sonarqube-token.js';
import { SonarQubeClient, type SonarQubeIssue } from './sonarqube-client.js';

// ====== SonarQube Raw Issue 类型 ======

export type { SonarQubeIssue };
export { globalTokenManager } from './sonarqube-token.js';
export { SonarQubeClient } from './sonarqube-client.js';

// ====== Module 级 Raw Issues 缓存 ======
// 目的：避免 lintZipBuffer 对同一 projectKey 重复 scan；submit_game 可直接复用

const sonarIssuesCache = new Map<string, SonarQubeIssue[]>();

export function getCachedSonarIssues(projectKey: string): SonarQubeIssue[] | undefined {
  return sonarIssuesCache.get(projectKey);
}

export function clearCachedSonarIssues(projectKey?: string): void {
  if (projectKey) {
    sonarIssuesCache.delete(projectKey);
  } else {
    sonarIssuesCache.clear();
  }
}

// ====== 配置解析 ======

async function resolveConfig(context?: LintContext): Promise<{
  baseUrl: string; token: string; projectKey: string; projectName: string;
}> {
  const baseUrl = (context?.sonarQubeUrl as string)
    || process.env.SONARQUBE_HOST
    || `http://localhost:${process.env.SONARQUBE_PORT ?? '9002'}`;
  const token = (context?.sonarQubeToken as string)
    || await globalTokenManager.ensureToken();
  const projectKey = context?.projectId ? `game-${context.projectId}` : 'game-default';
  return { baseUrl, token, projectKey, projectName: `Game ${projectKey}` };
}

// ====== ZIP 打包辅助 =====

/**
 * 递归地将一个目录添加到 yazl ZipFile。
 * @param srcDir 源目录绝对路径
 * @param zip ZipFile 实例
 * @param prefix ZIP 内的路径前缀（如 'source'）
 */
async function addDirToZip(srcDir: string, zip: yazl.ZipFile, prefix: string): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(srcDir, entry.name);
    const zipPath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await addDirToZip(fullPath, zip, zipPath);
    } else if (entry.isFile()) {
      zip.addFile(fullPath, zipPath);
    }
  }
}

/**
 * 将 HTML 内容以及可选的 gameDirPath 打包为单一 ZIP buffer。
 * 目录结构：
 *   html_content/<fileName>   （仅当 content 非空时）
 *   source/                   （仅当 gameDirPath 存在时，目录内容平铺）
 *
 * 如需将原 zipBuffer 也合并进来（htmlContent + zipBuffer 混合场景），
 * 调用方应自行用 yazl 将两者合并后传入 zipBuffer；本函数不处理跨 ZIP 合并。
 */
async function buildZipBuffer(
  content: string,
  context?: LintContext,
): Promise<Buffer | null> {
  const zip = new yazl.ZipFile();
  let hasContent = false;
  const tasks: Promise<void>[] = [];

  // html_content/ 目录
  if (content && content.trim().length > 0) {
    const fileName = context?.fileName ?? 'index.html';
    zip.addBuffer(Buffer.from(content, 'utf-8'), `html_content/${fileName}`);
    hasContent = true;
  }

  // source/ 目录
  if (context?.gameDirPath) {
    tasks.push(addDirToZip(context.gameDirPath, zip, 'source'));
  }

  await Promise.all(tasks);

  // 两者都没有 → 返回 null 表示跳过
  if (!hasContent && !context?.gameDirPath) {
    return null;
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

/**
 * 将原 zipBuffer 与 htmlContent 合并为单一 ZIP：
 *   html_content/<fileName>   ← htmlContent
 *   source/                   ← zipBuffer 解压后放入
 */
async function mergeZipAndHtml(
  zipBuffer: Buffer,
  htmlContent: string,
  context?: LintContext,
): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  // 1. 添加 html_content/
  const fileName = context?.fileName ?? 'index.html';
  zip.addBuffer(Buffer.from(htmlContent, 'utf-8'), `html_content/${fileName}`);

  // 2. 解析 zipBuffer 中每个 entry，解压后加入新 zip
  await addZipBufferEntriesToZip(zipBuffer, zip, 'source');

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => { resolve(Buffer.concat(chunks)); });
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

/**
 * 解析 ZIP buffer，将每个 entry 解压后添加到目标 yazl.ZipFile。
 * @param srcBuf  源 ZIP buffer
 * @param zip     目标 yazl.ZipFile（须已打开）
 * @param prefix  ZIP 内路径前缀（如 'source'）
 */
async function addZipBufferEntriesToZip(
  srcBuf: Buffer,
  zip: yazl.ZipFile,
  prefix: string,
): Promise<void> {
  const promises: Promise<void>[] = [];
  let offset = 0;

  while (offset < srcBuf.length) {
    // 读取 local file header
    const sig = srcBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // 不是 local file header，结束

    const compressionMethod = srcBuf.readUInt16LE(offset + 8);
    const compressedSize = srcBuf.readUInt32LE(offset + 18);
    const uncompressedSize = srcBuf.readUInt32LE(offset + 22);
    const nameLen = srcBuf.readUInt16LE(offset + 26);
    const extraLen = srcBuf.readUInt16LE(offset + 28);
    const name = srcBuf.toString('utf-8', offset + 30, offset + 30 + nameLen);
    const dataOffset = offset + 30 + nameLen + extraLen;

    // 跳过目录
    if (!name.endsWith('/')) {
      const compressedData = srcBuf.subarray(dataOffset, dataOffset + compressedSize);
      let content: Buffer;

      if (compressionMethod === 0) {
        // stored
        content = compressedData;
      } else if (compressionMethod === 8) {
        // deflate
        content = await new Promise<Buffer>((res, rej) => {
          const chunks: Buffer[] = [];
          const inflate = createInflate();
          inflate.on('data', (c: Buffer) => chunks.push(c));
          inflate.on('end', () => res(Buffer.concat(chunks)));
          inflate.on('error', rej);
          inflate.write(compressedData);
          inflate.end();
        });
      } else {
        // 不支持的压缩方法，跳过
        offset = dataOffset + compressedSize;
        continue;
      }

      promises.push(
        new Promise<void>((res) => {
          zip.addBuffer(content, `${prefix}/${name}`);
          res();
        }),
      );
    }

    offset = dataOffset + compressedSize;
  }

  await Promise.all(promises);
}

// ====== SonarQube Checker ======

export const sonarqubeChecker: LintChecker = {
  id: 'sonarqube',
  name: 'SonarQube 代码质量扫描',
  description: '通过 SonarQube 对游戏 HTML/JS 内容进行静态质量分析',

  async check(content: string, context?: LintContext): Promise<LintIssue[]> {
    const cid = sonarqubeChecker.id;
    const { baseUrl, token, projectKey } = await resolveConfig(context);
    const client = new SonarQubeClient(baseUrl, token);

    console.error(`[SonarQube checker] 开始扫描 project=${projectKey}`);

    // 命中缓存：同一 projectKey 在同一 lintZipBuffer 流程中不重复 scan
    if (sonarIssuesCache.has(projectKey)) {
      const cached = sonarIssuesCache.get(projectKey)!;
      console.error(`[SonarQube checker] 命中缓存 project=${projectKey} issues=${cached.length}`);
      return cached.map(si => ({
        ruleId: `sonarqube:${si.rule}`,
        level: ['BLOCKER', 'CRITICAL', 'MAJOR'].includes(si.severity) ? 'error' : 'warn',
        message: si.message,
        line: si.line,
        checkerId: cid,
      }));
    }

    // scanner 微服务 unavailable → graceful degrade（sonar 扫描可选，不阻断提交）
    try {
      const zipBuffer = context?.zipBuffer;
      const htmlContent = context?.htmlContent;

      // 需要打包的 ZIP buffer
      let scanZipBuffer: Buffer | null = null;

      if (zipBuffer) {
        // 有原始 ZIP：优先直接使用
        if (htmlContent && htmlContent.trim().length > 0) {
          // 有 htmlContent → 合并 html_content/ + 原 ZIP 到同一 ZIP
          scanZipBuffer = await mergeZipAndHtml(zipBuffer, htmlContent, context);
          console.error(`[SonarQube checker] 合并 zipBuffer + htmlContent size=${scanZipBuffer.length}`);
        } else {
          scanZipBuffer = zipBuffer;
          console.error(`[SonarQube checker] 使用原始 zipBuffer size=${zipBuffer.length}`);
        }
      } else {
        // 无原始 ZIP → 从 HTML content 和/或 gameDirPath 打包
        scanZipBuffer = await buildZipBuffer(content, context);
      }

      if (!scanZipBuffer) {
        // 两者均无 → 跳过扫描
        console.error(`[SonarQube checker] 无扫描内容（无 zipBuffer 且无 HTML/gameDir），跳过 project=${projectKey}`);
        return [];
      }

      // 1. 提交扫描任务到 scanner 微服务
      console.error(`[SonarQube checker] 提交 ZIP 到 scanner 服务 project=${projectKey} size=${scanZipBuffer.length}`);
      await submitScan({ projectId: projectKey, zipBuffer: scanZipBuffer });

      // 2. 轮询直到扫描完成
      console.error(`[SonarQube checker] 等待扫描完成 project=${projectKey}`);
      const finalStatus = await pollScanStatus({
        projectId: projectKey,
        intervalMs: 3000,
        timeoutMs: 120000,
        onPoll: (status) => {
          console.error(`[SonarQube checker] 扫描状态 project=${projectKey} status=${status.status} message=${status.message}`);
        },
      });

      if (finalStatus.status === 'error') {
        console.error(`[SonarQube checker] 扫描失败 project=${projectKey} message=${finalStatus.message}`);
        // scanner 扫描失败不阻断提交，降级返回空 issues
        return [];
      }

      // 3. 扫描成功，从 SonarQube 拉取 issues
      console.error(`[SonarQube checker] 拉取 issues project=${projectKey}`);
      const sonarIssues = await client.getProjectIssues(projectKey);

      // 缓存 raw issues，供 submit_game 复用（按 projectKey 隔离）
      sonarIssuesCache.set(projectKey, sonarIssues);

      const errors = sonarIssues.filter(si => ['BLOCKER', 'CRITICAL', 'MAJOR'].includes(si.severity));
      console.error(`[SonarQube checker] 扫描完成 project=${projectKey} totalIssues=${sonarIssues.length} errors=${errors.length}`);

      return sonarIssues.map(si => ({
        ruleId: `sonarqube:${si.rule}`,
        level: ['BLOCKER', 'CRITICAL', 'MAJOR'].includes(si.severity) ? 'error' : 'warn',
        message: si.message,
        line: si.line,
        checkerId: cid,
      }));

    } catch (err: any) {
      // scanner 微服务调用异常 → graceful degrade，不阻断游戏提交
      console.error(`[SonarQube checker] scanner 服务异常 project=${projectKey} error=${err?.message}`);
      return [];
    }
  },
};
