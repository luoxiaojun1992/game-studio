/**
 * Build Service Client — Node.js 游戏打包微服务 API 封装.
 *
 * 所有函数均为内部逻辑，供 tool 和 future backend API 共用。
 * 不直接依赖 agentId / logFn 等运行时上下文（由调用方注入）。
 */
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { resolveSafePath } from './db.js';
import type { AgentRole } from './agents.js';

const BUILD_SERVICE_URL = process.env.BUILD_SERVICE_URL || 'http://localhost:8085';

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

export async function buildFetch(path: string, init?: RequestInit): Promise<any> {
  const url = `${BUILD_SERVICE_URL}${path}`;
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
    throw new Error(`Build API error ${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// 项目管理
// ---------------------------------------------------------------------------

export interface CreateBuildProjectOptions {
  projectId: string;   // studio project id（闭包锚点）
  name: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function createBuildProject(opts: CreateBuildProjectOptions): Promise<{ dbId: string; buildProjectId: string }> {
  const { projectId, name, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const now = new Date().toISOString();

  // 1. 调用 build service 创建项目目录（微服务内部生成 project_id）
  let buildProjectId: string;
  try {
    const res = await buildFetch('/api/projects', {
      method: 'POST',
    });
    buildProjectId = res?.project_id;
    if (!buildProjectId) {
      throw new Error('build service 未返回 project_id');
    }
  } catch (error: any) {
    throw new Error(`创建打包 project 失败：${error?.message || String(error)}`);
  }

  // 2. 在 backend DB 创建记录
  const dbId = uuidv4();
  db.createBuildProject({
    id: dbId,
    project_id: projectId,
    build_project_id: buildProjectId,
    name: name.trim(),
    game_type: null,
    build_status: 'pending',
    created_at: now,
    updated_at: now,
  });

  log(agentId, '创建打包 project', `id=${dbId}, build_project_id=${buildProjectId}`, 'success');
  return { dbId, buildProjectId };
}

export function listBuildProjects(projectId: string, limit = 20): db.DbBuildProject[] {
  return db.getBuildProjects(projectId).slice(0, limit);
}

export interface DeleteBuildProjectOptions {
  projectId: string;
  buildProjectId: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteBuildProject(opts: DeleteBuildProjectOptions): Promise<void> {
  const { projectId, buildProjectId: bpId, agentId, logFn } = opts;
  const log = logFn || (() => {});

  // 1. 查询 DB 记录
  const records = db.getBuildProjects(projectId)
    .filter(r => r.build_project_id === bpId);
  const record = records[0];

  // 2. 调用 build service 删除（幂等）
  try {
    await buildFetch(`/api/projects/${bpId}`, { method: 'DELETE' });
  } catch {
    // 幂等：忽略
  }

  // 3. 删除 DB 记录
  if (record) {
    db.deleteBuildProject(record.id);
  }

  log(agentId, '删除打包 project', `build_project_id=${bpId}`, 'success');
}

// ---------------------------------------------------------------------------
// 源码上传
// ---------------------------------------------------------------------------

export interface UploadBuildSourceOptions {
  buildProjectId: string;
  tarGz: Buffer;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function uploadBuildSource(opts: UploadBuildSourceOptions): Promise<{ fileCount: number }> {
  const { buildProjectId: bpId, tarGz, agentId, logFn } = opts;
  const log = logFn || (() => {});

  const url = `${BUILD_SERVICE_URL}/api/projects/${bpId}/upload`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip' },
    body: tarGz,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`上传源码失败 HTTP ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const fileCount = data?.file_count || 0;

  log(agentId, '上传游戏源码', `project=${bpId}, files=${fileCount}`, 'success');
  return { fileCount };
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

export interface BuildTriggerResult {
  success: boolean;
  build_log: string;
  game_type: string;
  strategy: string;
  output_dir: string;
  message: string;
  files: string[];
}

export interface TriggerBuildOptions {
  buildProjectId: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function triggerBuild(opts: TriggerBuildOptions): Promise<BuildTriggerResult> {
  const { buildProjectId: bpId, agentId, logFn } = opts;
  const log = logFn || (() => {});

  const result: BuildTriggerResult = await buildFetch(`/api/build/${bpId}`, {
    method: 'POST',
  });

  log(agentId, '触发构建', `game_type=${result.game_type}, strategy=${result.strategy}, files=${result.files.length}`, 'success');
  return result;
}

export interface BuildStatusResult {
  project_id: string;
  build_status: string;
  game_type?: string;
  build_log?: string;
  output_files: string[];
}

export interface GetBuildStatusOptions {
  buildProjectId: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function getBuildStatus(opts: GetBuildStatusOptions): Promise<BuildStatusResult> {
  const { buildProjectId: bpId } = opts;
  return buildFetch(`/api/build/${bpId}/status`);
}

// ---------------------------------------------------------------------------
// 文件管理
// ---------------------------------------------------------------------------

export { BUILD_SERVICE_URL };

export interface UploadBuildFileOptions {
  buildProjectId: string;
  filename: string;
  content: string;        // base64 编码的文件内容
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function uploadBuildFile(opts: UploadBuildFileOptions): Promise<{ sizeBytes: number }> {
  const { buildProjectId: bpId, filename, content, agentId, logFn } = opts;
  const log = logFn || (() => {});

  const res = await buildFetch(`/api/files/${bpId}/${encodeURIComponent(filename.trim())}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });

  const sizeBytes = res?.size_bytes || 0;
  log(agentId, '上传文件', `${filename} -> build-project=${bpId}, size=${sizeBytes}`, 'success');
  return { sizeBytes };
}

export interface ListBuildFilesOptions {
  buildProjectId: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export interface BuildFileInfo {
  filename: string;
  type: string;
  size_bytes?: number;
}

export async function listBuildFiles(opts: ListBuildFilesOptions): Promise<BuildFileInfo[]> {
  const { buildProjectId: bpId } = opts;
  const res = await buildFetch(`/api/files/${bpId}`);
  return res?.files || [];
}

export interface DownloadBuildOptions {
  buildProjectId: string;
  localOutputDir: string;  // 绝对路径
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function downloadBuild(opts: DownloadBuildOptions): Promise<{ localPath: string; sizeBytes: number }> {
  const { buildProjectId: bpId, localOutputDir, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const pathModule = await import('path');
  const fsModule = await import('fs');

  // Download entire project as tar.gz
  const downloadUrl = `${BUILD_SERVICE_URL}/api/files/${bpId}/download`;
  const downloadRes = await fetch(downloadUrl);
  if (!downloadRes.ok) {
    throw new Error(`下载构建产物失败：HTTP ${downloadRes.status}`);
  }

  const buffer = Buffer.from(await downloadRes.arrayBuffer());

  // Ensure output directory exists
  const outputDir = pathModule.resolve(localOutputDir);
  if (!fsModule.existsSync(outputDir)) {
    fsModule.mkdirSync(outputDir, { recursive: true });
  }

  const localPath = pathModule.join(outputDir, `${bpId}.tar.gz`);
  fsModule.writeFileSync(localPath, buffer);

  log(agentId, '下载构建产物', `${bpId}.tar.gz -> ${localPath}, size=${buffer.length}`, 'success');
  return { localPath, sizeBytes: buffer.length };
}

export interface DeleteBuildFileOptions {
  buildProjectId: string;
  filename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteBuildFile(opts: DeleteBuildFileOptions): Promise<void> {
  const { buildProjectId: bpId, filename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const safeFilename = filename.trim();

  // 删除远程文件（幂等）
  try {
    await buildFetch(`/api/files/${bpId}/${encodeURIComponent(safeFilename)}`, { method: 'DELETE' });
  } catch {
    // 幂等：忽略
  }

  log(agentId, '删除文件', `build_project_id=${bpId}, filename=${safeFilename}`, 'success');
}
