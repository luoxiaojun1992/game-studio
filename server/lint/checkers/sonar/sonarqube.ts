/**
 * SonarQube 代码质量扫描检查器
 *
 * 通过 scanner 微服务（SonarScanner CLI）对游戏内容进行静态质量分析。
 *
 * 工作流程（调用 scanner 微服务）：
 * 1. 将 ZIP 包 POST 到 /api/scans/{project_id}
 * 2. 轮询 GET /api/scans/{project_id} 直到 done/error
 * 3. 调用 SonarQube REST API 拉取 issues
 * 4. scanner 微服务自动清理 ZIP 和 sources 目录
 *
 * 依赖：
 * - scanner 微服务（SCANNER_SERVICE_URL，默认 http://localhost:8081）
 * - SonarQube 服务（SONARQUBE_HOST）
 */

import type { LintChecker, LintIssue, LintContext } from '../types.js';
import { submitScan, pollScanStatus } from '../../sonar-scanner-service.js';
import { globalTokenManager } from './sonarqube-token.js';
import { SonarQubeClient, type SonarQubeIssue } from './sonarqube-client.js';

// ====== SonarQube Raw Issue 类型 ======

export type { SonarQubeIssue };

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
      // 优先使用 lintZipBuffer 传入的原始 ZIP buffer
      const zipBuffer = context?.zipBuffer;
      if (!zipBuffer) {
        console.error(`[SonarQube checker] 无 zipBuffer，跳过扫描 project=${projectKey}`);
        return [];
      }

      // 1. 提交扫描任务到 scanner 微服务
      console.error(`[SonarQube checker] 提交 ZIP 到 scanner 服务 project=${projectKey} size=${zipBuffer.length}`);
      await submitScan({ projectId: projectKey, zipBuffer });

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
