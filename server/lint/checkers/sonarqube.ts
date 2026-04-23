/**
 * SonarQube 代码质量扫描检查器
 *
 * 通过 SonarQube REST API 对游戏内容进行静态质量分析。
 *
 * 工作流程：
 * 1. 创建/获取 SonarQube 项目（projectKey 来自 context 或自动生成）
 * 2. 上传游戏 ZIP 包作为分析源码
 * 3. 触发扫描任务并轮询直到完成
 * 4. 从 SonarQube 问题列表中提取 LintIssue
 *
 * 依赖 SonarQube 服务运行于 http://localhost:9000（.env SONARQUBE_PORT=9000）
 * 认证凭证：.env SONARQUBE_DB_PASSWORD（默认 sonarpass）
 */

import type { LintChecker, LintIssue, LintContext } from '../types.js';

// ====== SonarQube 客户端 ======

interface SonarQubeIssue {
  key: string;
  rule: string;
  severity: string;
  component: string;
  line?: number;
  message: string;
  type: string;
}

interface SonarTaskResponse {
  task?: { id: string; status: string; type: string; componentKey?: string };
  taskId?: string;
}

interface SonarIssuesResponse {
  issues: SonarQubeIssue[];
  total: number;
}

class SonarQubeClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    const creds = Buffer.from(`${this.token}:`).toString('base64');
    return { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' };
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/system/health`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch { return false; }
  }

  async ensureProject(projectKey: string, projectName: string): Promise<void> {
    const getRes = await fetch(
      `${this.baseUrl}/api/projects/search?projects=${encodeURIComponent(projectKey)}`,
      { headers: this.authHeaders(), signal: AbortSignal.timeout(10000) }
    );
    if (getRes.ok) {
      const data = await getRes.json() as { projects?: Array<{ key: string }> };
      if (data.projects?.some(p => p.key === projectKey)) return;
    }

    const cr = await fetch(`${this.baseUrl}/api/projects/create`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: new URLSearchParams({ name: projectName, key: projectKey, visibility: 'public' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!cr.ok) {
      const body = await cr.text();
      if (!body.includes('key already exists')) {
        throw new Error(`SonarQube 项目创建失败: ${cr.status} ${body}`);
      }
    }
  }

  async submitAnalysis(projectKey: string, zipBuffer: Buffer): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), `${projectKey}.zip`);

    const res = await fetch(
      `${this.baseUrl}/api/sources/upload?project=${encodeURIComponent(projectKey)}`,
      { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.token}:`).toString('base64')}` }, body: form, signal: AbortSignal.timeout(60000) }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SonarQube 源码上传失败: ${res.status} ${body}`);
    }

    const data = await res.json() as SonarTaskResponse;
    return data.task?.id ?? data.taskId ?? '';
  }

  async waitForTask(taskId: string, timeoutMs = 120000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let interval = 2000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      interval = Math.min(interval * 1.3, 8000);

      const res = await fetch(
        `${this.baseUrl}/api/ce/task?id=${encodeURIComponent(taskId)}`,
        { headers: this.authHeaders(), signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) continue;

      const data = await res.json() as SonarTaskResponse;
      if (data.task?.status === 'SUCCESS') return;
      if (data.task?.status === 'FAILED' || data.task?.status === 'CANCELED') {
        throw new Error(`SonarQube 扫描任务失败: ${data.task.status}`);
      }
    }
    throw new Error('SonarQube 扫描任务超时');
  }

  async getProjectIssues(projectKey: string): Promise<SonarQubeIssue[]> {
    const all: SonarQubeIssue[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${this.baseUrl}/api/issues/search?projects=${encodeURIComponent(projectKey)}&ps=100&p=${page}`,
        { headers: this.authHeaders(), signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) throw new Error(`SonarQube issues 查询失败: ${res.status}`);
      const data = await res.json() as SonarIssuesResponse;
      all.push(...data.issues);
      if (all.length >= data.total) break;
      page++;
    }
    return all;
  }
}

// ====== ZIP 打包（无外部依赖） ======

/**
 * CRC32 查表
 */
function makeCrcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

const CRC_TABLE = makeCrcTable();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const b of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 将 parts 打包为标准 ZIP Buffer（DEFLATE 压缩）
 */
function buildZipBuffer(parts: Array<{ name: string; data: string }>): Buffer {
  const parts2: Array<{ name: string; content: Buffer }> = parts.map(p => ({
    name: p.name,
    content: Buffer.from(p.data, 'utf8'),
  }));

  // 先收集所有数据，估算 buffer 大小
  const chunks: Buffer[] = [];
  const localHeaders: Buffer[] = [];
  let dataOffset = 0;

  for (const { name, content } of parts2) {
    const nameBuf = Buffer.from(name, 'utf8');
    // deflate 压缩
    const compressed = deflateRaw(content);
    const size = compressed.length;

    // Local file header
    const hdr = Buffer.alloc(30 + nameBuf.length);
    hdr.writeUInt32LE(0x04034b50, 0);
    hdr.writeUInt16LE(20, 4);
    hdr.writeUInt16LE(0, 6);            // flags
    hdr.writeUInt16LE(8, 8);            // DEFLATE
    hdr.writeUInt16LE(0, 10);          // mod time
    hdr.writeUInt16LE(0, 12);          // mod date
    hdr.writeUInt32LE(crc32(content), 14);
    hdr.writeUInt32LE(size, 18);
    hdr.writeUInt32LE(content.length, 22);
    hdr.writeUInt16LE(nameBuf.length, 26);
    hdr.writeUInt16LE(0, 28);
    nameBuf.copy(hdr, 30);

    localHeaders.push(hdr);
    chunks.push(hdr, compressed);
    dataOffset += hdr.length + size;
  }

  // Central directory
  const cd: Buffer[] = [];
  let cdOffset = dataOffset;

  for (let i = 0; i < parts2.length; i++) {
    const { name, content } = parts2[i];
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRaw(content);
    const hdr = localHeaders[i];

    const entry = Buffer.alloc(46 + nameBuf.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);        // DEFLATE
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0, 14);
    entry.writeUInt32LE(crc32(content), 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt32LE(0, 32);         // disk start
    entry.writeUInt16LE(0, 36);         // internal attr
    entry.writeUInt32LE(0, 38);         // external attr
    entry.writeUInt32LE(hdr.readUInt32LE(42 - 30) /* local header offset placeholder */, 42);
    // Re-write with real offset: overwrite bytes 42-45 with dataOffset
    entry.writeUInt32LE(cdOffset, 42);
    nameBuf.copy(entry, 46);

    cd.push(entry);
    cdOffset += entry.length;
  }

  // End of central directory
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(parts2.length, 8);
  eocd.writeUInt16LE(parts2.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(dataOffset, 16);

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

/**
 * 简化的 DEFLATE 原始压缩（zlib格式，无 header）
 */
function deflateRaw(data: Buffer): Buffer {
  const zlib = require('zlib') as typeof import('zlib');
  return zlib.deflateRawSync(data);
}

/**
 * 将 HTML 内容包装为适合 SonarQube 分析的结构
 */
function wrapHtmlForSonarQube(content: string, fileName: string): string {
  if (/<html[\s>]/i.test(content)) return content;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${fileName}</title>
</head>
<body>
${content}
</body>
</html>`;
}

// ====== 配置解析 ======

function resolveConfig(context?: LintContext): {
  baseUrl: string; token: string; projectKey: string; projectName: string;
} {
  const baseUrl = (context?.sonarQubeUrl as string)
    || `http://localhost:${process.env.SONARQUBE_PORT ?? '9000'}`;
  const token = (context?.sonarQubeToken as string)
    || process.env.SONARQUBE_TOKEN
    || process.env.SONARQUBE_DB_PASSWORD
    || 'sonarpass';
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
    const { baseUrl, token, projectKey, projectName } = resolveConfig(context);
    const client = new SonarQubeClient(baseUrl, token);
    const fileName = context?.fileName ?? 'game.html';

    // 服务可用性检查（不阻断，降级为 warn）
    if (!await client.ping()) {
      return [{
        ruleId: 'sonarqube-unavailable',
        level: 'warn',
        message: `SonarQube 服务（${baseUrl}）不可访问，跳过代码质量扫描。`,
        checkerId: cid,
      }];
    }

    try {
      await client.ensureProject(projectKey, projectName);

      // 优先使用 lintZipBuffer 传入的原始 ZIP buffer，避免重复打包
      const zip = context?.zipBuffer
        ?? buildZipBuffer([
          { name: `dist/${fileName}`, data: wrapHtmlForSonarQube(content, fileName) },
          { name: `dist/game.html`, data: wrapHtmlForSonarQube(content, fileName) },
        ]);

      const taskId = await client.submitAnalysis(projectKey, zip);
      await client.waitForTask(taskId);

      const sonarIssues = await client.getProjectIssues(projectKey);

      return sonarIssues.map(si => ({
        ruleId: `sonarqube:${si.rule}`,
        level: ['BLOCKER', 'CRITICAL', 'MAJOR'].includes(si.severity) ? 'error' : 'warn',
        message: si.message,
        line: si.line,
        checkerId: cid,
      }));
    } catch (err: any) {
      return [{
        ruleId: 'sonarqube-analysis-error',
        level: 'warn',
        message: `SonarQube 扫描异常: ${err?.message ?? String(err)}`,
        checkerId: cid,
      }];
    }
  },
};
