/**
 * Creator Service Client — Blender 微服务 API 封装.
 *
 * 所有函数均为内部逻辑，供 tool 和 future backend API 共用。
 * 不直接依赖 agentId / logFn 等运行时上下文（由调用方注入）。
 */
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import type { AgentRole } from './agents.js';

const CREATOR_SERVICE_URL = process.env.CREATOR_SERVICE_URL || 'http://localhost:8080';

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

export async function creatorFetch(path: string, init?: RequestInit): Promise<any> {
  const url = `${CREATOR_SERVICE_URL}${path}`;
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
    throw new Error(`Creator API error ${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// 项目管理
// ---------------------------------------------------------------------------

export interface CreateBlenderProjectOptions {
  projectId: string;   // studio project id（闭包锚点）
  blenderProjectId?: string;  // 可选，默认 uuidv4
  name: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function createBlenderProject(opts: CreateBlenderProjectOptions): Promise<{ dbId: string; blenderProjectId: string }> {
  const { projectId, blenderProjectId: maybeBpId, name, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const now = new Date().toISOString();
  const dbId = uuidv4();
  const blenderProjectId = maybeBpId || uuidv4();

  // 1. 在 backend DB 创建记录（blender_project_id 待填）
  const record = db.createBlenderProject({
    id: dbId,
    project_id: projectId,
    blender_project_id: blenderProjectId,
    name: name.trim(),
    created_at: now,
    updated_at: now,
  });

  // 2. 调用 creator service 创建项目目录
  try {
    const res = await creatorFetch(`/api/projects/${blenderProjectId}`, {
      method: 'POST',
    });
    const returnedId: string = res?.project_id || blenderProjectId;
    if (returnedId !== blenderProjectId) {
      db.updateBlenderProject(dbId, { blender_project_id: returnedId });
    }
    log(agentId, '创建建模 project', `id=${dbId}, blender_project_id=${returnedId}`, 'success');
    return { dbId, blenderProjectId: returnedId };
  } catch (error: any) {
    db.deleteBlenderProject(dbId);
    throw new Error(`创建建模 project 失败：${error?.message || String(error)}`);
  }
}

export function listBlenderProjects(projectId: string, limit = 20): db.DbBlenderProject[] {
  return db.getBlenderProjects(projectId).slice(0, limit);
}

export interface DeleteBlenderProjectOptions {
  projectId: string;
  blenderProjectId: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteBlenderProject(opts: DeleteBlenderProjectOptions): Promise<void> {
  const { projectId, blenderProjectId: bpId, agentId, logFn } = opts;
  const log = logFn || (() => {});

  // 1. 查询 DB 记录
  const records = db.getBlenderProjects(projectId)
    .filter(r => r.blender_project_id === bpId);
  const record = records[0];

  // 2. 调用 creator service 删除（幂等）
  try {
    await creatorFetch(`/api/projects/${bpId}`, { method: 'DELETE' });
  } catch {
    // 幂等：忽略（404 也算删除成功）
  }

  // 3. 删除 DB 记录
  if (record) {
    db.deleteBlenderProject(record.id);
  }

  log(agentId, '删除建模 project', `blender_project_id=${bpId}`, 'success');
}

// ---------------------------------------------------------------------------
// Blender 操作
// ---------------------------------------------------------------------------

export interface BlenderCreateMeshOptions {
  blenderProjectId: string;
  meshType: 'cube' | 'sphere' | 'plane' | 'cylinder' | 'torus' | 'cone';
  name: string;
  location?: [number, number, number];
  scale?: [number, number, number];
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function blenderCreateMesh(opts: BlenderCreateMeshOptions): Promise<string> {
  const { blenderProjectId: bpId, meshType, name, location, scale, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    mesh_type: meshType,
    name: name.trim(),
    location: location || [0, 0, 0],
    scale: scale || [1, 1, 1],
  };
  const res = await creatorFetch(`/api/blender/create_mesh?project_id=${bpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, 'Blender 创建网格', `${meshType} "${name}"`, 'success');
  return res?.output || '';
}

export interface BlenderAddMaterialOptions {
  blenderProjectId: string;
  objectName: string;
  color?: [number, number, number];
  metallic?: number;
  roughness?: number;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function blenderAddMaterial(opts: BlenderAddMaterialOptions): Promise<string> {
  const { blenderProjectId: bpId, objectName, color, metallic, roughness, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    object_name: objectName.trim(),
    color: color || [0.8, 0.8, 0.8],
    metallic: metallic ?? 0.0,
    roughness: roughness ?? 0.5,
  };
  const res = await creatorFetch(`/api/blender/add_material?project_id=${bpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, 'Blender 添加材质', `物体="${objectName}"`, 'success');
  return res?.output || '';
}

export interface BlenderExportModelOptions {
  blenderProjectId: string;
  objectName: string;
  outputFilename: string;
  format?: 'glb' | 'fbx' | 'obj' | 'ply' | 'usd';
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function blenderExportModel(opts: BlenderExportModelOptions): Promise<string> {
  const { blenderProjectId: bpId, objectName, outputFilename, format = 'glb', agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    object_name: objectName.trim(),
    output_filename: outputFilename.trim(),
    format,
  };
  const res = await creatorFetch(`/api/blender/export?project_id=${bpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, 'Blender 导出模型', `${format} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface BlenderExecuteScriptOptions {
  blenderProjectId: string;
  script: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function blenderExecuteScript(opts: BlenderExecuteScriptOptions): Promise<string> {
  const { blenderProjectId: bpId, script, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = { script: script.trim() };
  const res = await creatorFetch(`/api/blender/exec?project_id=${bpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, 'Blender 执行脚本', `blender_project_id=${bpId}`, 'success');
  return res?.output || '';
}

// ---------------------------------------------------------------------------
// 文件管理
// ---------------------------------------------------------------------------

export { CREATOR_SERVICE_URL };

export interface DownloadModelFileOptions {
  blenderProjectId: string;
  filename: string;
  localOutputDir: string;  // 绝对路径，如 /app/output/{project_id}/models
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function downloadModelFile(opts: DownloadModelFileOptions): Promise<{ localPath: string; sizeBytes: number }> {
  const { blenderProjectId: bpId, filename, localOutputDir, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const safeFilename = filename.trim();

  // 先检查文件在 creator 端是否存在
  const fileList: any = await creatorFetch(`/api/files/${bpId}`);
  const found = fileList?.files?.find((f: any) => f.filename === safeFilename);
  if (!found) {
    throw new Error(`文件不存在：${safeFilename}`);
  }

  // 下载文件到 backend output 目录
  const { execSync } = await import('child_process');
  const pathModule = await import('path');
  const fsModule = await import('fs');

  const outputDir = pathModule.resolve(localOutputDir);
  if (!fsModule.existsSync(outputDir)) {
    fsModule.mkdirSync(outputDir, { recursive: true });
  }
  const localPath = pathModule.join(outputDir, safeFilename);

  const downloadRes = await fetch(`${CREATOR_SERVICE_URL}/api/files/${bpId}/${encodeURIComponent(safeFilename)}`);
  if (!downloadRes.ok) {
    throw new Error(`下载失败：HTTP ${downloadRes.status}`);
  }
  const buffer = await downloadRes.arrayBuffer();
  fsModule.writeFileSync(localPath, Buffer.from(buffer));

  log(agentId, '下载模型文件', `${safeFilename} -> ${localPath}`, 'success');
  return { localPath, sizeBytes: found.size_bytes };
}

export interface DeleteModelFileOptions {
  blenderProjectId: string;
  filename: string;
  localOutputDir: string;  // 绝对路径
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteModelFile(opts: DeleteModelFileOptions): Promise<void> {
  const { blenderProjectId: bpId, filename, localOutputDir, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const safeFilename = filename.trim();

  // 1. 删除 creator 远程文件（幂等）
  try {
    await creatorFetch(`/api/files/${bpId}/${encodeURIComponent(safeFilename)}`, { method: 'DELETE' });
  } catch {
    // 幂等：忽略（文件不存在也算删除成功）
  }

  // 2. 删除 backend 本地副本（如果存在）
  const pathModule = await import('path');
  const fsModule = await import('fs');
  const localPath = pathModule.resolve(pathModule.join(localOutputDir, safeFilename));
  if (fsModule.existsSync(localPath)) {
    fsModule.unlinkSync(localPath);
  }

  log(agentId, '删除模型文件', `blender_project_id=${bpId}, filename=${safeFilename}`, 'success');
}
