/**
 * FileStorage API
 * 提供文件上传/下载/删除/更新接口，内部自动拼接 {project_id}/{object_key} 为 MinIO 存储路径
 */
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import * as minio from './minio-client.js';

const router = express.Router();

const PROJECT_ID_PATTERN = db.PROJECT_ID_PATTERN;
const MAX_PROJECT_ID_LENGTH = db.MAX_PROJECT_ID_LENGTH;
const DEFAULT_PROJECT_ID = 'default';

const normalizeProjectId = (value: unknown): string => {
  if (typeof value !== 'string') return DEFAULT_PROJECT_ID;
  const raw = value.trim();
  if (!raw) return DEFAULT_PROJECT_ID;
  if (raw.length > MAX_PROJECT_ID_LENGTH) return DEFAULT_PROJECT_ID;
  if (!PROJECT_ID_PATTERN.test(raw)) return DEFAULT_PROJECT_ID;
  return raw;
};

const validateProjectIdInput = (value: unknown, fieldName: string): { ok: true; projectId: string } | { ok: false; error: string } => {
  if (value === undefined || value === null) return { ok: true, projectId: DEFAULT_PROJECT_ID };
  if (typeof value !== 'string') return { ok: false, error: `${fieldName} 必须是字符串` };
  const raw = value.trim();
  if (!raw) return { ok: true, projectId: DEFAULT_PROJECT_ID };
  if (raw.length > MAX_PROJECT_ID_LENGTH) return { ok: false, error: `${fieldName} 长度不能超过 ${MAX_PROJECT_ID_LENGTH}` };
  if (!PROJECT_ID_PATTERN.test(raw)) return { ok: false, error: `${fieldName} 不合法，请使用字母数字下划线或短横线` };
  return { ok: true, projectId: raw };
};

// GET /api/file-storage — 列表（按 project_id 筛选）
router.get('/', (req: Request, res: Response) => {
  const projectValidation = validateProjectIdInput(req.query.projectId, 'projectId');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const storages = db.getFileStorages(projectValidation.projectId);
  res.json({ fileStorages: storages });
});

// POST /api/file-storage — 创建记录，返回 upload presigned URL
router.post('/', async (req: Request, res: Response) => {
  const { project_id, object_key, file_name, file_size, content_type } = req.body;

  const projectValidation = validateProjectIdInput(project_id, 'project_id');
  if (!projectValidation.ok) return res.status(400).json({ error: projectValidation.error });
  const projectId = projectValidation.projectId;

  if (!object_key) return res.status(400).json({ error: 'object_key 不能为空' });
  if (typeof object_key !== 'string') return res.status(400).json({ error: 'object_key 必须是字符串' });

  let validatedObjectKey: string;
  try {
    validatedObjectKey = db.normalizeAndValidateRequiredText(object_key, 'object_key');
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'object_key 验证失败' });
  }

  // 内部自动拼接 {project_id}/{object_key} 为最终存储路径
  const fullObjectKey = `${projectId}/${validatedObjectKey}`;

  const fileNameValidation = db.normalizeOptionalText(file_name ?? null, 'file_name');
  const contentTypeValidation = db.normalizeOptionalText(content_type ?? null, 'content_type');

  const now = new Date().toISOString();
  const id = uuidv4();

  // 检查唯一约束
  const existing = db.getFileStorages(projectId).find(s => s.object_key === validatedObjectKey);
  if (existing) {
    return res.status(409).json({ error: `object_key 已存在: ${validatedObjectKey}` });
  }

  let storage: db.DbFileStorage;
  try {
    storage = db.createFileStorage({
      id,
      project_id: projectId,
      object_key: validatedObjectKey,
      file_name: fileNameValidation,
      file_size: typeof file_size === 'number' ? file_size : null,
      content_type: contentTypeValidation,
      created_at: now,
      updated_at: now
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '创建文件存储记录失败' });
  }

  // 生成 presigned upload URL
  let uploadUrl: string;
  try {
    uploadUrl = await minio.getPresignedUploadUrl(fullObjectKey);
  } catch (error: any) {
    // 如果 MinIO 不可用，仍返回记录和 uploadUrl（供外部上传）
    console.error('[file-storage] MinIO presigned URL error:', error);
    uploadUrl = '';
  }

  res.json({
    fileStorage: storage,
    uploadUrl,
    fullObjectKey
  });
});

// GET /api/file-storage/:id — 获取单条记录
router.get('/:id', (req: Request, res: Response) => {
  const storage = db.getFileStorage(req.params.id);
  if (!storage) return res.status(404).json({ error: '文件存储记录不存在' });
  res.json({ fileStorage: storage });
});

// GET /api/file-storage/:id/download — 获取 download presigned URL
router.get('/:id/download', async (req: Request, res: Response) => {
  const storage = db.getFileStorage(req.params.id);
  if (!storage) return res.status(404).json({ error: '文件存储记录不存在' });

  const fullObjectKey = `${storage.project_id}/${storage.object_key}`;
  let downloadUrl: string;
  try {
    downloadUrl = await minio.getPresignedDownloadUrl(fullObjectKey);
  } catch (error: any) {
    console.error('[file-storage] MinIO presigned download URL error:', error);
    return res.status(503).json({ error: '获取下载链接失败，MinIO 服务不可用' });
  }

  res.json({ downloadUrl, fileName: storage.file_name });
});

// PATCH /api/file-storage/:id — 更新记录，返回 upload presigned URL
router.patch('/:id', async (req: Request, res: Response) => {
  const storage = db.getFileStorage(req.params.id);
  if (!storage) return res.status(404).json({ error: '文件存储记录不存在' });

  const { object_key, file_name, file_size, content_type } = req.body;
  const updates: Partial<db.DbFileStorage> = {};

  if (object_key !== undefined) {
    try {
      updates.object_key = db.normalizeAndValidateRequiredText(object_key, 'object_key');
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'object_key 验证失败' });
    }
  }
  if (file_name !== undefined) {
    updates.file_name = db.normalizeOptionalText(file_name, 'file_name');
  }
  if (file_size !== undefined) {
    updates.file_size = typeof file_size === 'number' ? file_size : null;
  }
  if (content_type !== undefined) {
    updates.content_type = db.normalizeOptionalText(content_type, 'content_type');
  }

  if (updates.object_key && updates.object_key !== storage.object_key) {
    const existing = db.getFileStorages(storage.project_id).find(s => s.object_key === updates.object_key && s.id !== req.params.id);
    if (existing) {
      return res.status(409).json({ error: `object_key 已存在: ${updates.object_key}` });
    }
  }

  const success = db.updateFileStorage(req.params.id, updates);
  if (!success) return res.status(500).json({ error: '更新失败' });

  const updated = db.getFileStorage(req.params.id)!;
  const fullObjectKey = `${updated.project_id}/${updated.object_key}`;

  let uploadUrl: string;
  try {
    uploadUrl = await minio.getPresignedUploadUrl(fullObjectKey);
  } catch (error: any) {
    console.error('[file-storage] MinIO presigned URL error:', error);
    uploadUrl = '';
  }

  res.json({ fileStorage: updated, uploadUrl, fullObjectKey });
});

// DELETE /api/file-storage/:id — 删除记录 + MinIO 对象
router.delete('/:id', async (req: Request, res: Response) => {
  const storage = db.getFileStorage(req.params.id);
  if (!storage) return res.status(404).json({ error: '文件存储记录不存在' });

  const fullObjectKey = `${storage.project_id}/${storage.object_key}`;

  // 先删除 MinIO 对象（忽略错误）
  try {
    await minio.deleteObject(fullObjectKey);
  } catch (error) {
    console.warn('[file-storage] MinIO delete object warning:', error);
  }

  db.deleteFileStorage(req.params.id);
  res.json({ success: true });
});

// ============================================================
// 内部纯函数（供 API 和 tool 共用）
// ============================================================

export async function createFileStorageRecord(params: {
  project_id: string;
  object_key: string;
  file_name?: string | null;
  file_size?: number | null;
  content_type?: string | null;
}): Promise<{ storage: db.DbFileStorage; fullObjectKey: string }> {
  const projectValidation = validateProjectIdInput(params.project_id, 'project_id');
  if (!projectValidation.ok) throw new Error(projectValidation.error);
  const projectId = projectValidation.projectId;

  if (!params.object_key) throw new Error('object_key 不能为空');
  const validatedObjectKey = db.normalizeAndValidateRequiredText(params.object_key, 'object_key');

  const fileNameValidation = db.normalizeOptionalText(params.file_name ?? null, 'file_name');
  const contentTypeValidation = db.normalizeOptionalText(params.content_type ?? null, 'content_type');

  // 检查唯一约束
  const existing = db.getFileStorages(projectId).find(s => s.object_key === validatedObjectKey);
  if (existing) throw new Error(`object_key 已存在: ${validatedObjectKey}`);

  const now = new Date().toISOString();
  const id = uuidv4();

  const storage = db.createFileStorage({
    id,
    project_id: projectId,
    object_key: validatedObjectKey,
    file_name: fileNameValidation,
    file_size: typeof params.file_size === 'number' ? params.file_size : null,
    content_type: contentTypeValidation,
    created_at: now,
    updated_at: now
  });

  const fullObjectKey = `${projectId}/${validatedObjectKey}`;
  return { storage, fullObjectKey };
}

export async function uploadBuffer(
  buffer: Buffer,
  objectKey: string,
  contentType: string
): Promise<void> {
  await minio.putObject(objectKey, buffer, buffer.length, contentType);
}

export {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteObject as deleteMinioObject,
} from './minio-client.js';

export {
  getFileStorage as getFileStorageRecord,
  getFileStorages as getFileStorageRecords,
  updateFileStorage as updateFileStorageRecord,
  deleteFileStorage as deleteFileStorageRecord,
} from './db.js';

export default router;
