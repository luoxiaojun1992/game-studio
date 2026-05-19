/**
 * SonarQube 代码质量扫描检查器
 *
 * 通过 scanner 微服务（SonarScanner CLI）对游戏内容进行静态质量分析。
 *
 * 工作流程：
 * 1. 从 context.submitDir 读取游戏成品目录，打包为 ZIP
 * 2. 将 ZIP 包 POST 到 /api/scans/{project_id}
 * 3. 轮询 GET /api/scans/{project_id} 直到 done/error
 * 4. 调用 SonarQube REST API 拉取 issues
 * 5. scanner 微服务自动清理 ZIP 和 sources 目录
 *
 * 依赖：
 * - scanner 微服务（SCANNER_SERVICE_URL，默认 http://localhost:8081）
 * - SonarQube 服务（SONARQUBE_HOST）
 */

import yazl from 'yazl';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import type { LintChecker, LintIssue, LintContext } from '../../types.js';
import { submitScan, pollScanStatus } from '../../../sonar-scanner-service.js';
import { globalTokenManager } from './sonarqube-token.js';
import { SonarQubeClient, type SonarQubeIssue } from './sonarqube-client.js';

const _sqts = () => new Date().toISOString();

// ====== SonarQube Raw Issue 类型 ======

export type { SonarQubeIssue };
export { globalTokenManager } from './sonarqube-token.js';
export { SonarQubeClient } from './sonarqube-client.js';

// ====== 扫描历史管理（基于 zipBuffer hash 去重 + LRU 淘汰） ======
// 目的：根据 ZIP 内容 hash 判断是否需要扫描，相同内容不重复扫描

const MAX_CACHE_SIZE = 50;  // 最多缓存 50 个项目的扫描结果

type ScanRecord = {
  zipHash: string;  // ZIP 内容的 MD5 hash
  issues: SonarQubeIssue[];  // 缓存的扫描结果
};
// LRU 缓存：按插入顺序排列，最新插入的在末尾，最久未使用的在头部
const scanHistory: Map<string, ScanRecord> = new Map();

/**
 * 计算 Buffer 的 MD5 hash（十六进制字符串）
 */
function computeZipHash(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * LRU 淘汰：当缓存超过上限时，移除最旧的条目
 */
function evictOldestIfNeeded(): void {
  if (scanHistory.size >= MAX_CACHE_SIZE) {
    // 删除最旧的条目（Map 的第一个 key）
    const oldestKey = scanHistory.keys().next().value;
    if (oldestKey) {
      scanHistory.delete(oldestKey);
      console.error(`[SonarQube checker] ${_sqts()} LRU 淘汰 project=${oldestKey} 当前缓存大小=${scanHistory.size}`);
    }
  }
}

/**
 * 获取扫描历史中的缓存 issues（zipBuffer 未变化时直接返回缓存）
 */
export function getCachedSonarIssues(projectKey: string, zipBuffer: Buffer): SonarQubeIssue[] | null {
  const record = scanHistory.get(projectKey);
  if (!record) return null;

  const currentHash = computeZipHash(zipBuffer);
  if (record.zipHash !== currentHash) {
    // ZIP 内容变了，清除旧缓存
    console.error(`[SonarQube checker] ${_sqts()} ZIP 内容已变化，清除旧缓存 project=${projectKey}`);
    scanHistory.delete(projectKey);
    return null;
  }

  // LRU 更新：将该条目移到末尾（标记为最近使用）
  scanHistory.delete(projectKey);
  scanHistory.set(projectKey, record);

  console.error(`[SonarQube checker] ${_sqts()} 命中缓存，跳过扫描 project=${projectKey} issues=${record.issues.length}`);
  return record.issues;
}

/**
 * 保存扫描结果到历史缓存
 */
export function cacheSonarIssues(projectKey: string, zipBuffer: Buffer, issues: SonarQubeIssue[]): void {
  evictOldestIfNeeded();  // 先检查是否需要淘汰
  scanHistory.set(projectKey, {
    zipHash: computeZipHash(zipBuffer),
    issues,
  });
  console.error(`[SonarQube checker] ${_sqts()} 缓存扫描结果 project=${projectKey} 缓存大小=${scanHistory.size}`);
}

/**
 * @deprecated 使用 getCachedSonarIssues + cacheSonarIssues 替代
 */
export function resetSonarScanHistory(projectKey?: string): void {
  if (projectKey) {
    scanHistory.delete(projectKey);
    console.error(`[SonarQube checker] ${_sqts()} 重置扫描历史 project=${projectKey}`);
  } else {
    scanHistory.clear();
    console.error(`[SonarQube checker] ${_sqts()} 重置全部扫描历史`);
  }
}

// ====== 配置解析 ======

async function resolveConfig(context: LintContext): Promise<{
  baseUrl: string; token: string; projectKey: string; projectName: string;
}> {
  const baseUrl = (context.sonarQubeUrl as string)
    || process.env.SONARQUBE_HOST
    || `http://localhost:${process.env.SONARQUBE_PORT ?? '9002'}`;
  const token = (context.sonarQubeToken as string)
    || await globalTokenManager.ensureToken();
  const projectKey = context.projectId ? `game-${context.projectId}` : 'game-default';
  return { baseUrl, token, projectKey, projectName: `Game ${projectKey}` };
}

// ====== ZIP 打包辅助 ======

/**
 * 从游戏成品目录打包为 ZIP buffer。
 * 递归添加目录下所有文件，保持目录结构。
 */
async function buildZipFromDir(dirPath: string): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  const entries = collectFiles(dirPath);

  for (const entry of entries) {
    zip.addFile(entry.fullPath, entry.relativePath);
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

interface FileEntry {
  fullPath: string;
  relativePath: string;
}

function collectFiles(dirPath: string): FileEntry[] {
  const entries: FileEntry[] = [];
  const readDir = (currentPath: string, relativePrefix: string) => {
    let names: string[];
    try {
      names = fs.readdirSync(currentPath);
    } catch { return; }
    for (const name of names) {
      const fullPath = path.join(currentPath, name);
      const relativePath = relativePrefix ? `${relativePrefix}/${name}` : name;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          readDir(fullPath, relativePath);
        } else if (stat.isFile()) {
          entries.push({ fullPath, relativePath });
        }
      } catch { /* skip inaccessible files */ }
    }
  };
  readDir(dirPath, '');
  return entries;
}

// ====== SonarQube Checker ======

export const sonarqubeChecker: LintChecker = {
  id: 'sonarqube',
  name: 'SonarQube 代码质量扫描',
  description: '通过 SonarQube 对游戏 HTML/JS 内容进行静态质量分析',

  async check(context: LintContext): Promise<LintIssue[]> {
    const cid = sonarqubeChecker.id;
    const { baseUrl, token, projectKey } = await resolveConfig(context);
    const client = new SonarQubeClient(baseUrl, token);

    console.error(`[SonarQube checker] ${_sqts()} 开始扫描 project=${projectKey} submitDir=${context?.submitDir ?? '(none)'}`);

    // scanner 微服务 unavailable → graceful degrade（sonar 扫描可选，不阻断提交）
    try {
      const submitDir = context?.submitDir;
      if (!submitDir || !fs.existsSync(submitDir)) {
        console.error(`[SonarQube checker] ${_sqts()} 跳过扫描：submitDir 为空或不存在 submitDir=${submitDir}`);
        return [];
      }

      // 从 submitDir 打包 ZIP
      console.error(`[SonarQube checker] ${_sqts()} 从 submitDir 打包 ZIP project=${projectKey}`);
      const scanZipBuffer = await buildZipFromDir(submitDir);
      if (!scanZipBuffer || scanZipBuffer.length === 0) {
        console.error(`[SonarQube checker] ${_sqts()} 打包 ZIP 为空，跳过扫描 project=${projectKey}`);
        return [];
      }
      console.error(`[SonarQube checker] ${_sqts()} ZIP 打包完成 project=${projectKey} size=${scanZipBuffer.length}`);

      // 先检查缓存（基于 hash 去重）
      const cachedIssues = getCachedSonarIssues(projectKey, scanZipBuffer);
      if (cachedIssues !== null) {
        const errors = cachedIssues.filter(si => ['BLOCKER', 'CRITICAL', 'MAJOR'].includes(si.severity));
        console.error(`[SonarQube checker] ${_sqts()} 命中缓存，跳过扫描 project=${projectKey} errors=${errors.length}`);
        return cachedIssues.map(si => ({
          ruleId: `sonarqube:${si.rule}`,
          level: ['BLOCKER', 'CRITICAL', 'MAJOR'].includes(si.severity) ? 'error' : 'warn',
          message: si.message,
          line: si.line,
          checkerId: cid,
        }));
      }

      // 2. 提交扫描任务到 scanner 微服务
      console.error(`[SonarQube checker] ${_sqts()} 提交 ZIP 到 scanner 服务 project=${projectKey} size=${scanZipBuffer.length}`);
      await submitScan({ projectId: projectKey, zipBuffer: scanZipBuffer });

      // 3. 轮询直到扫描完成
      console.error(`[SonarQube checker] ${_sqts()} 等待扫描完成 project=${projectKey}`);
      const finalStatus = await pollScanStatus({
        projectId: projectKey,
        intervalMs: 3000,
        timeoutMs: 120000,
        onPoll: (status) => {
          console.error(`[SonarQube checker] ${_sqts()} 扫描状态 project=${projectKey} status=${status.status} message=${status.message}`);
        },
      });

      if (finalStatus.status === 'error') {
        const msg = `SonarQube scan failed: ${finalStatus.message}`;
        console.error(`[SonarQube checker] ${_sqts()} ${msg}`);
        throw new Error(msg);  // throw 让 LintRunner 捕获并转为 lintIssue
      }

      // 4. 扫描成功，从 SonarQube 拉取 issues
      console.error(`[SonarQube checker] ${_sqts()} 拉取 issues project=${projectKey}`);
      const sonarIssues = await client.getProjectIssues(projectKey);

      // 缓存扫描结果（基于 zipBuffer hash）
      cacheSonarIssues(projectKey, scanZipBuffer, sonarIssues);

      // 写入 extraPayloads，供 submit_game 直接读取并上传到 MinIO
      if (context?.__extraPayloads) {
        context.__extraPayloads['sonar-report'] = {
          version: '1.0',
          issues: sonarIssues,
        };
      }

      const errors = sonarIssues.filter(si => ['BLOCKER', 'CRITICAL', 'MAJOR'].includes(si.severity));
      console.error(`[SonarQube checker] ${_sqts()} 扫描完成 project=${projectKey} totalIssues=${sonarIssues.length} errors=${errors.length} issues=${JSON.stringify(sonarIssues.map(i => ({ rule: i.rule, severity: i.severity, message: i.message })))}`);

      return sonarIssues.map(si => ({
        ruleId: `sonarqube:${si.rule}`,
        level: ['BLOCKER', 'CRITICAL', 'MAJOR'].includes(si.severity) ? 'error' : 'warn',
        message: si.message,
        line: si.line,
        checkerId: cid,
      }));

    } catch (err: any) {
      // scanner 微服务任何异常 → 抛出转为 lintIssue，阻断游戏提交
      console.error(`[SonarQube checker] ${_sqts()} scanner 服务异常 project=${projectKey} error=${err?.message}`);
      throw err;
    }
  },
};
