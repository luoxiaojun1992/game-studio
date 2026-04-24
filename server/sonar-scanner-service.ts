/**
 * Scanner Service Client — Sonar Scanner 微服务 API 封装.
 *
 * 所有函数均为内部逻辑，供 sonarqubeChecker 调用。
 * 不直接依赖 agentId / logFn 等运行时上下文（由调用方注入）。
 */
import { resolveSafePath } from './db.js';

const SCANNER_SERVICE_URL = process.env.SCANNER_SERVICE_URL || 'http://localhost:8081';

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

export async function scannerFetch(path: string, init?: RequestInit): Promise<any> {
  const url = `${SCANNER_SERVICE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok && res.status !== 204) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`Scanner API error ${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// 扫描操作
// ---------------------------------------------------------------------------

export interface ScanSubmitOptions {
  projectId: string;   // studio project id（闭包锚点，同时也是 scanner service 的 project_id）
  zipBuffer: Buffer;   // 游戏 ZIP 包二进制内容
  /**
   * 上传 ZIP 到 scanner 服务的 form field 名称，默认为 'file'
   * scanner service 期望 multipart/form-data，field name 为 'file'
   */
  fileFieldName?: string;
}

export interface ScanStatus {
  status: 'submitted' | 'scanning' | 'done' | 'error' | 'unknown';
  message: string;
  taskId?: string;
  exitCode?: number;
}

/**
 * 上传 ZIP 包到 scanner 服务并立即返回（后台异步扫描）。
 * 返回 scan ID / projectId 用于后续查询状态。
 */
export async function submitScan(opts: ScanSubmitOptions): Promise<{ projectId: string }> {
  const { projectId, zipBuffer, fileFieldName = 'file' } = opts;

  const form = new FormData();
  // Buffer to Blob
  const blob = new Blob([zipBuffer], { type: 'application/zip' });
  form.append(fileFieldName, blob, `${projectId}.zip`);

  const res = await fetch(`${SCANNER_SERVICE_URL}/api/scans/${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: form,
    // 注意：FormData 自动设置正确的 Content-Type（multipart/form-data; boundary=xxx）
    // 不要手动设置 Content-Type
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Scanner submit error ${res.status}: ${detail}`);
  }

  const json = await res.json() as { project_id: string; status: string; message?: string };
  return { projectId: json.project_id };
}

/**
 * 轮询扫描状态，直到 done / error / 超时。
 *
 * @param projectId - scanner service 的 project_id
 * @param options.intervalMs - 轮询间隔，默认 3000ms
 * @param options.timeoutMs - 总超时，默认 120000ms（2分钟）
 * @param options.onPoll - 每次轮询回调，传入当前状态
 * @returns 最终 ScanStatus
 */
export interface PollScanOptions {
  projectId: string;
  intervalMs?: number;
  timeoutMs?: number;
  onPoll?: (status: ScanStatus) => void;
}

export async function pollScanStatus(opts: PollScanOptions): Promise<ScanStatus> {
  const { projectId, intervalMs = 3000, timeoutMs = 120000, onPoll } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getScanStatus(projectId);
    onPoll?.(status);

    if (status.status === 'done' || status.status === 'error') {
      return status;
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return {
    status: 'error',
    message: `Scan poll timeout after ${timeoutMs}ms`,
  };
}

/**
 * 查询扫描状态（一次性，不轮询）。
 */
export async function getScanStatus(projectId: string): Promise<ScanStatus> {
  const json = await scannerFetch(`/api/scans/${encodeURIComponent(projectId)}`);
  return {
    status: json.status as ScanStatus['status'],
    message: json.message ?? '',
    taskId: json.task_id ?? undefined,
    exitCode: json.exit_code ?? undefined,
  };
}

/**
 * 删除扫描工作目录（幂等）。
 */
export async function deleteScan(projectId: string): Promise<void> {
  await scannerFetch(`/api/scans/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export { SCANNER_SERVICE_URL };
