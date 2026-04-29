/**
 * Proposal Attachments API
 * 提供策划案附件的查询、上传、删除接口
 * 存储路径规则：object_key = design/{UUID}.{format}（与 drawio_download_diagram 保持一致）
 */
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import * as minio from './minio-client.js';
import { createFileStorageRecord } from './file-storage.js';
import multer from 'multer';

const router = express.Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CUSTOM_NAME_LENGTH = 200;
const CUSTOM_NAME_PATTERN = /^[^\x00-\x1f<>:"|?*\x80-\x9f]{1,200}$/;
const MAX_ATTACHMENTS_PER_PROPOSAL = 10;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// POST /api/proposals/:proposalId/attachments — 手动上传附件
router.post('/:proposalId/attachments', upload.single('file'), async (req: Request, res: Response) => {
  const { proposalId } = req.params;

  if (!UUID_PATTERN.test(proposalId)) {
    return res.status(400).json({ error: 'proposalId 格式非法' });
  }

  const proposal = db.getProposal(proposalId);
  if (!proposal) {
    return res.status(404).json({ error: '策划案不存在' });
  }

  const currentCount = db.countProposalAttachments(proposalId);
  if (currentCount >= MAX_ATTACHMENTS_PER_PROPOSAL) {
    return res.status(400).json({ error: `每个策划案最多 ${MAX_ATTACHMENTS_PER_PROPOSAL} 个附件` });
  }

  const file = (req as any).file;
  if (!file) {
    return res.status(400).json({ error: '未上传文件' });
  }

  const { custom_name } = req.body as { custom_name?: string };

  // custom_name 校验
  let normalizedCustomName: string | null = null;
  if (custom_name && typeof custom_name === 'string' && custom_name.trim()) {
    const trimmed = custom_name.trim();
    if (trimmed.length > MAX_CUSTOM_NAME_LENGTH) {
      return res.status(400).json({ error: `自定义名称不能超过 ${MAX_CUSTOM_NAME_LENGTH} 字符` });
    }
    if (!CUSTOM_NAME_PATTERN.test(trimmed)) {
      return res.status(400).json({ error: '自定义名称包含非法字符（不允许 <>:"|?* 及控制字符）' });
    }
    normalizedCustomName = trimmed;
  }

  // 生成 object_key（与 drawio_download_diagram 一致）
  const ext = file.originalname.includes('.') ? file.originalname.split('.').pop()! : 'bin';
  const fileUuid = uuidv4();
  const objectKey = `design/${fileUuid}.${ext}`;

  try {
    // 上传到 MinIO
    await minio.putObject(objectKey, file.buffer, file.size, file.mimetype);

    // 创建 file_storage 记录
    const { storage } = await createFileStorageRecord({
      project_id: proposal.project_id,
      object_key: objectKey,
      file_name: file.originalname,
      file_size: file.size,
      content_type: file.mimetype,
    });

    // 创建 proposal_attachment 记录
    const attachment = db.createProposalAttachment({
      id: uuidv4(),
      proposal_id: proposalId,
      file_storage_id: storage.id,
      source_type: 'manual_upload',
      custom_name: normalizedCustomName,
      created_at: new Date().toISOString(),
    });

    res.json({
      attachment: {
        ...attachment,
        file_name: file.originalname,
        file_size: file.size,
        content_type: file.mimetype,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: `上传失败：${error?.message || String(error)}` });
  }
});

// GET /api/proposals/:proposalId/attachments — 获取指定策划案的附件列表
router.get('/:proposalId/attachments', (req: Request, res: Response) => {
  const { proposalId } = req.params;

  if (!UUID_PATTERN.test(proposalId)) {
    return res.status(400).json({ error: 'proposalId 格式非法' });
  }

  const proposal = db.getProposal(proposalId);
  if (!proposal) {
    return res.status(404).json({ error: '策划案不存在' });
  }

  const attachments = db.getProposalAttachments(proposalId);

  const result = attachments.map(att => {
    const storage = db.getFileStorage(att.file_storage_id);
    return {
      id: att.id,
      proposal_id: att.proposal_id,
      file_storage_id: att.file_storage_id,
      source_type: att.source_type,
      custom_name: att.custom_name,
      created_at: att.created_at,
      file_name: storage?.file_name || null,
      file_size: storage?.file_size || null,
      content_type: storage?.content_type || null,
    };
  });

  res.json({ attachments: result });
});

// DELETE /api/proposals/:proposalId/attachments/:attachmentId — 删除附件
router.delete('/:proposalId/attachments/:attachmentId', async (req: Request, res: Response) => {
  const { proposalId, attachmentId } = req.params;

  if (!UUID_PATTERN.test(proposalId) || !UUID_PATTERN.test(attachmentId)) {
    return res.status(400).json({ error: 'ID 格式非法' });
  }

  const attachment = db.getProposalAttachments(proposalId).find(a => a.id === attachmentId);
  if (!attachment) {
    return res.status(404).json({ error: '附件不存在' });
  }

  // 删除 MinIO 对象（忽略错误）
  const storage = db.getFileStorage(attachment.file_storage_id);
  if (storage) {
    const fullObjectKey = `${storage.project_id}/${storage.object_key}`;
    try {
      await minio.deleteObject(fullObjectKey);
    } catch {
      // ignore
    }
    db.deleteFileStorage(storage.id);
  }

  db.deleteProposalAttachment(attachmentId);
  res.json({ success: true });
});

// GET /api/proposals/:proposalId/attachments/:attachmentId/download — 获取下载链接
router.get('/:proposalId/attachments/:attachmentId/download', async (req: Request, res: Response) => {
  const { proposalId, attachmentId } = req.params;

  if (!UUID_PATTERN.test(proposalId) || !UUID_PATTERN.test(attachmentId)) {
    return res.status(400).json({ error: 'ID 格式非法' });
  }

  const attachment = db.getProposalAttachments(proposalId).find(a => a.id === attachmentId);
  if (!attachment) {
    return res.status(404).json({ error: '附件不存在' });
  }

  const storage = db.getFileStorage(attachment.file_storage_id);
  if (!storage) {
    return res.status(404).json({ error: '文件存储记录不存在' });
  }

  const fullObjectKey = `${storage.project_id}/${storage.object_key}`;
  let downloadUrl: string;
  try {
    downloadUrl = await minio.getPresignedDownloadUrl(fullObjectKey);
  } catch (error: any) {
    return res.status(503).json({ error: '获取下载链接失败：MinIO 服务不可用' });
  }

  res.json({
    downloadUrl,
    fileName: attachment.custom_name || storage.file_name,
    file_size: storage.file_size,
    content_type: storage.content_type,
  });
});

export default router;
