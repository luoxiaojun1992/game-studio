/**
 * Modeling Tools —对接 creator service (Blender 微服务).
 *
 * 所有 tool 使用与 studio tools 相同的 projectIdSchema / requireProjectId 闭包
 * （由调用方在注册时注入 closure）。
 */
import { z } from 'zod';
import { tool, createSdkMcpServer, type SdkMcpServerResult } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

const CREATOR_SERVICE_URL = process.env.CREATOR_SERVICE_URL || 'http://localhost:8080';

type ToolLogFn = (agentId: string, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;

async function creatorFetch(path: string, init?: RequestInit): Promise<any> {
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
// Tool Server Factory
// ---------------------------------------------------------------------------

export function createModelingToolsServer(
  projectId: string,
  agentId: string,
  logFn?: ToolLogFn,
): SdkMcpServerResult {
  const log = logFn || (() => {});
  const scopedProjectId = (projectId || 'default').trim() || 'default';

  const projectIdSchema = z.string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'project_id 仅支持字母、数字、下划线、短横线')
    .min(1, 'project_id 不能为空')
    .max(64, 'project_id 不能超过 64 字符');

  const requireProjectId = (inputProjectId: string): string => {
    if (inputProjectId !== scopedProjectId) {
      throw new Error(`project_id 不匹配：传入 ${inputProjectId}，当前会话作用域为 ${scopedProjectId}`);
    }
    return inputProjectId;
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function requireBlenderProject(blenderProjectId: string): string {
    if (!blenderProjectId || typeof blenderProjectId !== 'string') {
      throw new Error('blender_project_id 不能为空');
    }
    return blenderProjectId;
  }

  function requireNonEmpty(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${fieldName} 不能为空`);
    }
    return value.trim();
  }

  // ---------------------------------------------------------------------------
  // Tool definitions
  // ---------------------------------------------------------------------------

  const server = createSdkMcpServer({
    name: 'modeling-tools',
    version: '1.0.0',
    tools: [

      // ---- Project management ----

      tool(
        'create_modeling_project',
        '创建建模 project。在 backend 数据库创建记录，然后调用 creator service 创建容器内项目目录，返回 blender_project_id。建议在完成建模工作后调用 delete_modeling_project 清理资源。',
        {
          project_id: projectIdSchema.describe('当前项目 ID，必填，用于隔离不同项目的数据'),
          name: z.string().min(1).max(50).describe('建模 project 名称'),
        },
        async ({ project_id, name }) => {
          const effectiveProjectId = requireProjectId(project_id);
          const now = new Date().toISOString();
          const dbId = uuidv4();
          const blenderProjectId = uuidv4(); // 先本地生成 UUID，creator 返回后更新

          // 1. 在 backend DB 创建记录（blender_project_id 待填）
          const record = db.createBlenderProject({
            id: dbId,
            project_id: effectiveProjectId,
            blender_project_id: blenderProjectId,
            name: requireNonEmpty(name, 'name'),
            created_at: now,
            updated_at: now,
          });

          // 2. 调用 creator service 创建项目目录
          try {
            const res = await creatorFetch(`/api/projects/${blenderProjectId}`, {
              method: 'POST',
            });
            // creator 返回 { project_id: blenderProjectId }
            const returnedId: string = res?.project_id || blenderProjectId;
            // 用 creator 返回的 ID 更新记录（如果不同）
            if (returnedId !== blenderProjectId) {
              db.updateBlenderProject(dbId, { blender_project_id: returnedId });
            }
            log(agentId, '创建建模 project', `id=${dbId}, blender_project_id=${returnedId}`, 'success');
            return {
              content: [{
                type: 'text' as const,
                text: `建模 project 已创建 (DB ID: ${dbId.slice(0, 8)}, blender_project_id: ${returnedId})，名称: ${name}`,
              }]
            };
          } catch (error: any) {
            // 回滚 DB 记录
            db.deleteBlenderProject(dbId);
            throw new Error(`创建建模 project 失败：${error?.message || String(error)}`);
          }
        }
      ),

      tool(
        'list_modeling_projects',
        '列出当前 studio project 下所有建模 project。',
        {
          project_id: projectIdSchema.describe('当前项目 ID，必填'),
          limit: z.number().min(1).max(50).optional().default(20).describe('返回条数上限'),
        },
        async ({ project_id, limit }) => {
          const effectiveProjectId = requireProjectId(project_id);
          const records = db.getBlenderProjects(effectiveProjectId).slice(0, limit || 20);
          if (records.length === 0) {
            return { content: [{ type: 'text' as const, text: '暂无建模 project。' }] };
          }
          const lines = records.map(r =>
            `[${r.id.slice(0, 8)}] ${r.name} | blender_project_id=${r.blender_project_id} | ${r.created_at.slice(0, 10)}`
          ).join('\n');
          return { content: [{ type: 'text' as const, text: lines }] };
        }
      ),

      tool(
        'delete_modeling_project',
        '删除建模 project。先调用 creator service 删除远程目录（幂等），再删除 backend DB 记录。建议完成模型文件下载后主动调用以释放容器存储空间。',
        {
          blender_project_id: z.string().describe('blender_project_id（来自 create_modeling_project 的返回值）'),
        },
        async ({ blender_project_id }) => {
          const bpId = requireBlenderProject(blender_project_id);

          // 1. 查询 DB 记录
          const records = db.getBlenderProjects(scopedProjectId)
            .filter(r => r.blender_project_id === bpId);
          const record = records[0];

          // 2. 调用 creator service 删除（幂等）
          try {
            await creatorFetch(`/api/projects/${bpId}`, { method: 'DELETE' });
          } catch {
            // 幂等：忽略错误（404 也算删除成功）
          }

          // 3. 删除 DB 记录
          if (record) {
            db.deleteBlenderProject(record.id);
          }

          log(agentId, '删除建模 project', `blender_project_id=${bpId}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `建模 project 已删除 (blender_project_id: ${bpId})` }]
          };
        }
      ),

      // ---- Blender operations ----

      tool(
        'blender_create_mesh',
        '在 Blender 场景中创建一个基础几何体（立方体/球体/平面/圆柱体/圆环/圆锥）。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          mesh_type: z.enum(['cube', 'sphere', 'plane', 'cylinder', 'torus', 'cone']).describe('几何体类型'),
          name: z.string().min(1).max(64).describe('物体名称'),
          location: z.tuple([z.number(), z.number(), z.number()]).optional()
            .describe('位置 (x, y, z)，默认 (0, 0, 0)'),
          scale: z.tuple([z.number(), z.number(), z.number()]).optional()
            .describe('缩放 (x, y, z)，默认 (1, 1, 1)'),
        },
        async ({ blender_project_id, mesh_type, name, location, scale }) => {
          const bpId = requireBlenderProject(blender_project_id);
          const payload = {
            mesh_type,
            name: requireNonEmpty(name, 'name'),
            location: location || [0, 0, 0],
            scale: scale || [1, 1, 1],
          };
          const res = await creatorFetch(`/api/blender/create_mesh?project_id=${bpId}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          log(agentId, 'Blender 创建网格', `${mesh_type} "${name}"`, 'success');
          return {
            content: [{ type: 'text' as const, text: `已创建 ${mesh_type} "${name}"。${res?.output || ''}` }]
          };
        }
      ),

      tool(
        'blender_add_material',
        '为 Blender 场景中的物体添加 PBR 材质。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          object_name: z.string().min(1).max(64).describe('物体名称'),
          color: z.tuple([z.number(), z.number(), z.number()]).optional()
            .describe('颜色 RGB (0-1)，默认 (0.8, 0.8, 0.8)'),
          metallic: z.number().min(0).max(1).optional().describe('金属度 0-1，默认 0'),
          roughness: z.number().min(0).max(1).optional().describe('粗糙度 0-1，默认 0.5'),
        },
        async ({ blender_project_id, object_name, color, metallic, roughness }) => {
          const bpId = requireBlenderProject(blender_project_id);
          const payload = {
            object_name: requireNonEmpty(object_name, 'object_name'),
            color: color || [0.8, 0.8, 0.8],
            metallic: metallic ?? 0.0,
            roughness: roughness ?? 0.5,
          };
          const res = await creatorFetch(`/api/blender/add_material?project_id=${bpId}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          log(agentId, 'Blender 添加材质', `物体="${object_name}"`, 'success');
          return {
            content: [{ type: 'text' as const, text: `材质已添加到 "${object_name}"。${res?.output || ''}` }]
          };
        }
      ),

      tool(
        'blender_export_model',
        '将 Blender 场景中的物体导出为模型文件（GLB/FBX/OBJ/PLY/USD）。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          object_name: z.string().min(1).max(64).describe('要导出的物体名称'),
          output_filename: z.string().min(1).max(128).describe('输出文件名（含扩展名，如 model.glb）'),
          format: z.enum(['glb', 'fbx', 'obj', 'ply', 'usd']).optional().default('glb').describe('导出格式'),
        },
        async ({ blender_project_id, object_name, output_filename, format }) => {
          const bpId = requireBlenderProject(blender_project_id);
          const payload = {
            object_name: requireNonEmpty(object_name, 'object_name'),
            output_filename: requireNonEmpty(output_filename, 'output_filename'),
            format: format || 'glb',
          };
          const res = await creatorFetch(`/api/blender/export?project_id=${bpId}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          log(agentId, 'Blender 导出模型', `${format} "${output_filename}"`, 'success');
          return {
            content: [{ type: 'text' as const, text: `已导出 "${object_name}" 为 ${format} 格式：${output_filename}。${res?.output || ''}` }]
          };
        }
      ),

      tool(
        'blender_execute_script',
        '在 Blender 场景中执行自定义 Python 脚本。用于预置操作无法满足的复杂场景。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          script: z.string().max(10 * 1024).describe('Blender Python 脚本代码（最长 10KB）'),
        },
        async ({ blender_project_id, script }) => {
          const bpId = requireBlenderProject(blender_project_id);
          const payload = { script: requireNonEmpty(script, 'script') };
          const res = await creatorFetch(`/api/blender/exec?project_id=${bpId}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          log(agentId, 'Blender 执行脚本', `blender_project_id=${bpId}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `脚本执行完成。${res?.output || ''}` }]
          };
        }
      ),

      // ---- File management ----

      tool(
        'download_model_file',
        '从 creator service 下载模型文件到 backend 本地 output 目录。下载完成后应主动调用 delete_model_file 清理 creator 远程资源。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          filename: z.string().min(1).max(128).describe('要下载的文件名'),
        },
        async ({ blender_project_id, filename }) => {
          const bpId = requireBlenderProject(blender_project_id);
          const safeFilename = requireNonEmpty(filename, 'filename');

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

          const outputDir = pathModule.resolve(pathModule.join(__dirname, '..', 'output', scopedProjectId, 'models'));
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
          return {
            content: [{
              type: 'text' as const,
              text: `文件已下载到：${localPath} (${found.size_bytes} bytes)`,
            }]
          };
        }
      ),

      tool(
        'delete_model_file',
        '删除 creator 远程模型文件（幂等）。下载到本地后应先调用此工具删除远程文件，再删除本地副本以释放容器存储空间。',
        {
          blender_project_id: z.string().describe('blender_project_id'),
          filename: z.string().min(1).max(128).describe('要删除的文件名'),
        },
        async ({ blender_project_id, filename }) => {
          const bpId = requireBlenderProject(blender_project_id);
          const safeFilename = requireNonEmpty(filename, 'filename');

          // 1. 删除 creator 远程文件（幂等）
          try {
            await creatorFetch(`/api/files/${bpId}/${encodeURIComponent(safeFilename)}`, { method: 'DELETE' });
          } catch {
            // 幂等：忽略（文件不存在也算删除成功）
          }

          // 2. 删除 backend 本地副本（如果存在）
          const pathModule = await import('path');
          const fsModule = await import('fs');
          const localPath = pathModule.resolve(pathModule.join(__dirname, '..', 'output', scopedProjectId, 'models', safeFilename));
          if (fsModule.existsSync(localPath)) {
            fsModule.unlinkSync(localPath);
          }

          log(agentId, '删除模型文件', `blender_project_id=${bpId}, filename=${safeFilename}`, 'success');
          return {
            content: [{ type: 'text' as const, text: `已删除模型文件：${safeFilename}（远程 + 本地）` }]
          };
        }
      ),

    ],
  });

  return server;
}
