/**
 * SonarQube 代码质量扫描检查器
 *
 * 通过 scanner 微服务（SonarScanner CLI）对游戏内容进行静态质量分析。
 *
 * 工作流程（调用 scanner 微服务）：
 * 1. 将 ZIP 包 POST 到 /api/scans/{project_id}
 *    - 有 zipBuffer → 直接发送
 *    - 无 zipBuffer，有 content (HTML) → 打包为 html_content/<fileName> 发送
 *    - 两者均无 → 跳过扫描
 * 2. 轮询 GET /api/scans/{project_id} 直到 done/error
 * 3. 调用 SonarQube REST API 拉取 issues
 * 4. scanner 微服务自动清理 ZIP 和 sources 目录
 *
 * 依赖：
 * - scanner 微服务（SCANNER_SERVICE_URL，默认 http://localhost:8081）
 * - SonarQube 服务（SONARQUBE_HOST）
 */

import yazl from 'yazl';

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

// ====== ZIP 打包辅助 ======

/**
 * 将 HTML 内容打包为单一 ZIP buffer。
 * 目录结构：html_content/<fileName>
 * 无 content 时返回 null 表示跳过扫描。
 */
async function buildZipBuffer(
  content: string,
  context?: LintContext,
): Promise<Buffer | null> {
  if (!content || content.trim().length === 0) {
    return null;
  }

  const zip = new yazl.ZipFile();
  const fileName = context?.fileName ?? 'index.html';
  zip.addBuffer(Buffer.from(content, 'utf-8'), `html_content/${fileName}`);

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

      // 需要打包的 ZIP buffer
      let scanZipBuffer: Buffer | null = null;

      if (zipBuffer) {
        // 有原始 ZIP：直接使用
        scanZipBuffer = zipBuffer;
        console.error(`[SonarQube checker] 使用原始 zipBuffer size=${zipBuffer.length}`);
      } else {
        // 无原始 ZIP → 从 HTML content 打包
        scanZipBuffer = await buildZipBuffer(content, context);
      }

      if (!scanZipBuffer) {
        // 两者均无 → 跳过扫描
        console.error(`[SonarQube checker] 无扫描内容（无 zipBuffer 且无 HTML），跳过 project=${projectKey}`);
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
        const msg = `SonarQube scan failed: ${finalStatus.message}`;
        console.error(`[SonarQube checker] ${msg}`);
        throw new Error(msg);  // throw 让 LintRunner 捕获并转为 lintIssue
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
      // scanner 微服务调用异常：
      // - 网络不可达等非预期异常 → graceful degrade（不阻断提交）
      // - 401/403 等认证错误 → 必须抛出，让 LintRunner 转为 error 级 lintIssue，阻断游戏提交
      const msg = err?.message || String(err);
      const isAuthError = /401|403|Unauthorized|Forbidden/i.test(msg);
      console.error(`[SonarQube checker] scanner 服务异常 project=${projectKey} isAuthError=${isAuthError} error=${msg}`);
      if (isAuthError) {
        throw err; // 认证错误 → LintRunner 捕获后转 lintIssue，阻断提交
      }
      return []; // 网络错误等非认证异常 → degrade，继续提交
    }
  },
};
