/**
 * Image Service Client — ImageMagick 微服务 API 封装.
 *
 * 所有函数均为内部逻辑，供 tool 和 future backend API 共用。
 * 不直接依赖 agentId / logFn 等运行时上下文（由调用方注入）。
 */
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { resolveSafePath } from './db.js';
import type { AgentRole } from './agents.js';

const IMAGE_SERVICE_URL = process.env.IMAGE_SERVICE_URL || 'http://localhost:8089';

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

export async function imageFetch(path: string, init?: RequestInit): Promise<any> {
  const url = `${IMAGE_SERVICE_URL}${path}`;
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
    throw new Error(`Image API error ${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// 项目管理
// ---------------------------------------------------------------------------

export interface CreateImageProjectOptions {
  projectId: string;   // studio project id（闭包锚点）
  name: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function createImageProject(opts: CreateImageProjectOptions): Promise<{ dbId: string; imageProjectId: string }> {
  const { projectId, name, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const now = new Date().toISOString();

  // 1. 调用 image service 创建项目目录（微服务内部生成 project_id）
  let imageProjectId: string;
  try {
    const res = await imageFetch('/api/projects', {
      method: 'POST',
    });
    imageProjectId = res?.project_id;
    if (!imageProjectId) {
      throw new Error('image service 未返回 project_id');
    }
  } catch (error: any) {
    throw new Error(`创建图片 project 失败：${error?.message || String(error)}`);
  }

  // 2. 在 backend DB 创建记录
  const dbId = uuidv4();
  db.createImageProject({
    id: dbId,
    project_id: projectId,
    image_project_id: imageProjectId,
    name: name.trim(),
    created_at: now,
    updated_at: now,
  });

  log(agentId, '创建图片 project', `id=${dbId}, image_project_id=${imageProjectId}`, 'success');
  return { dbId, imageProjectId };
}

export function listImageProjects(projectId: string, limit = 20): db.DbImageProject[] {
  return db.getImageProjects(projectId).slice(0, limit);
}

export interface DeleteImageProjectOptions {
  projectId: string;
  imageProjectId: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteImageProject(opts: DeleteImageProjectOptions): Promise<void> {
  const { projectId, imageProjectId: ipId, agentId, logFn } = opts;
  const log = logFn || (() => {});

  // 1. 查询 DB 记录
  const records = db.getImageProjects(projectId)
    .filter(r => r.image_project_id === ipId);
  const record = records[0];

  // 2. 调用 image service 删除（幂等）
  try {
    await imageFetch(`/api/projects/${ipId}`, { method: 'DELETE' });
  } catch {
    // 幂等：忽略
  }

  // 3. 删除 DB 记录
  if (record) {
    db.deleteImageProject(record.id);
  }

  log(agentId, '删除图片 project', `image_project_id=${ipId}`, 'success');
}

// ---------------------------------------------------------------------------
// 图片操作
// ---------------------------------------------------------------------------

export interface ImageResizeOptions {
  imageProjectId: string;
  inputFilename: string;
  width: number;
  height: number;
  keepAspect?: boolean;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageResize(opts: ImageResizeOptions): Promise<string> {
  const { imageProjectId: ipId, inputFilename, width, height, keepAspect = true, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    width,
    height,
    keep_aspect: keepAspect,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/resize?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片缩放', `${width}x${height} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageCropOptions {
  imageProjectId: string;
  inputFilename: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageCrop(opts: ImageCropOptions): Promise<string> {
  const { imageProjectId: ipId, inputFilename, width, height, x = 0, y = 0, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    width,
    height,
    x,
    y,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/crop?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片裁剪', `${width}x${height}+${x}+${y} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageConvertOptions {
  imageProjectId: string;
  inputFilename: string;
  targetFormat: 'png' | 'jpg' | 'webp' | 'avif' | 'gif' | 'bmp';
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageConvert(opts: ImageConvertOptions): Promise<string> {
  const { imageProjectId: ipId, inputFilename, targetFormat, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    target_format: targetFormat,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/convert?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片格式转换', `${targetFormat} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageCompressOptions {
  imageProjectId: string;
  inputFilename: string;
  quality: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageCompress(opts: ImageCompressOptions): Promise<string> {
  const { imageProjectId: ipId, inputFilename, quality, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    quality,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/compress?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片压缩', `quality=${quality} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageWatermarkOptions {
  imageProjectId: string;
  inputFilename: string;
  type?: 'text' | 'image';
  content?: string;
  text?: string;
  position?: string;
  opacity?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageWatermark(opts: ImageWatermarkOptions): Promise<string> {
  const { imageProjectId: ipId, inputFilename, type = 'text', content, text, position = 'southeast', opacity = 0.5, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    type,
    content: content || text || '',
    text: text || '',
    position,
    opacity,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/watermark?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片水印', `type=${type} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageCompositeOptions {
  imageProjectId: string;
  baseFilename: string;
  overlayFilename: string;
  gravity?: string;
  x?: number;
  y?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageComposite(opts: ImageCompositeOptions): Promise<string> {
  const { imageProjectId: ipId, baseFilename, overlayFilename, gravity = 'center', x = 0, y = 0, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    base_filename: baseFilename.trim(),
    overlay_filename: overlayFilename.trim(),
    gravity,
    x,
    y,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/composite?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片合成', `"${overlayFilename}" onto "${baseFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageFlipRotateOptions {
  imageProjectId: string;
  inputFilename: string;
  mode: 'flip' | 'flop' | 'rotate' | 'transpose' | 'transverse';
  angle?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageFlipRotate(opts: ImageFlipRotateOptions): Promise<string> {
  const { imageProjectId: ipId, inputFilename, mode, angle = 90, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    mode,
    angle,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/flip-rotate?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片翻转/旋转', `${mode} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageAddMarginOptions {
  imageProjectId: string;
  inputFilename: string;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  color?: string;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageAddMargin(opts: ImageAddMarginOptions): Promise<string> {
  const { imageProjectId: ipId, inputFilename, top = 0, right = 0, bottom = 0, left = 0, color = 'transparent', outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    top,
    right,
    bottom,
    left,
    color,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/add-margin?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片边距', `${top}/${right}/${bottom}/${left} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageColorAdjustOptions {
  imageProjectId: string;
  inputFilename: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageColorAdjust(opts: ImageColorAdjustOptions): Promise<string> {
  const { imageProjectId: ipId, inputFilename, brightness = 0, contrast = 0, saturation = 100, hue = 100, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    brightness,
    contrast,
    saturation,
    hue,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/color-adjust?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '图片色彩调整', `"${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface ImageInfoResult {
  filename: string;
  size_bytes: number;
  geometry?: string;
  format?: string;
  type?: string;
  colorspace?: string;
  channel_depth?: string;
  resolution?: string;
}

export async function imageGetInfo(opts: {
  imageProjectId: string;
  filename: string;
}): Promise<ImageInfoResult> {
  const { imageProjectId: ipId, filename } = opts;
  const res = await imageFetch(`/api/image/info?project_id=${ipId}&filename=${encodeURIComponent(filename.trim())}`);
  return res;
}

export interface ImageBatchOptions {
  imageProjectId: string;
  inputPattern: string;
  operation: string;
  operationParams?: Record<string, any>;
  outputDir?: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageBatch(opts: ImageBatchOptions): Promise<string> {
  const { imageProjectId: ipId, inputPattern, operation, operationParams = {}, outputDir = 'batch_output', agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_pattern: inputPattern.trim(),
    operation,
    operation_params: operationParams,
    output_dir: outputDir,
  };
  const res = await imageFetch(`/api/image/batch?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '批量处理', `${operation} "${inputPattern}"`, 'success');
  return res?.output || '';
}

export interface ImageSpriteSheetOptions {
  imageProjectId: string;
  files: string[];
  columns: number;
  rows: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function imageSpriteSheet(opts: ImageSpriteSheetOptions): Promise<string> {
  const { imageProjectId: ipId, files, columns, rows, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    files: files.map(f => f.trim()),
    columns,
    rows,
    output_filename: outputFilename.trim(),
  };
  const res = await imageFetch(`/api/image/sprite-sheet?project_id=${ipId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '精灵图', `${columns}x${rows} "${outputFilename}"`, 'success');
  return res?.output || '';
}

// ---------------------------------------------------------------------------
// 文件管理
// ---------------------------------------------------------------------------

export { IMAGE_SERVICE_URL };

// ---------------------------------------------------------------------------
// 文件上传（base64 → image service 项目目录）
// ---------------------------------------------------------------------------

export interface UploadImageFileOptions {
  imageProjectId: string;
  filename: string;
  content: string;        // base64 编码的图片内容
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function uploadImageFile(opts: UploadImageFileOptions): Promise<{ sizeBytes: number }> {
  const { imageProjectId: ipId, filename, content, agentId, logFn } = opts;
  const log = logFn || (() => {});

  const res = await imageFetch(`/api/files/${ipId}/${encodeURIComponent(filename.trim())}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });

  const sizeBytes = res?.size_bytes || 0;
  log(agentId, '上传图片文件', `${filename} -> image-project=${ipId}, size=${sizeBytes}`, 'success');
  return { sizeBytes };
}

export interface DownloadImageFileOptions {
  imageProjectId: string;
  filename: string;
  localOutputDir: string;  // 绝对路径
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function downloadImageFile(opts: DownloadImageFileOptions): Promise<{ localPath: string; sizeBytes: number }> {
  const { imageProjectId: ipId, filename, localOutputDir, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const safeFilename = filename.trim();

  // 先检查文件是否存在
  const fileList: any = await imageFetch(`/api/files/${ipId}`);
  const found = fileList?.files?.find((f: any) => f.filename === safeFilename);
  if (!found) {
    throw new Error(`文件不存在：${safeFilename}`);
  }

  // 下载文件到 backend output 目录
  const pathModule = await import('path');
  const fsModule = await import('fs');

  const outputDir = pathModule.resolve(localOutputDir);
  if (!fsModule.existsSync(outputDir)) {
    fsModule.mkdirSync(outputDir, { recursive: true });
  }
  const localPath = resolveSafePath(outputDir, safeFilename);

  const downloadRes = await fetch(`${IMAGE_SERVICE_URL}/api/files/${ipId}/${encodeURIComponent(safeFilename)}`);
  if (!downloadRes.ok) {
    throw new Error(`下载失败：HTTP ${downloadRes.status}`);
  }
  const buffer = await downloadRes.arrayBuffer();
  fsModule.writeFileSync(localPath, Buffer.from(buffer));

  log(agentId, '下载图片文件', `${safeFilename} -> ${localPath}`, 'success');
  return { localPath, sizeBytes: found.size_bytes };
}

export interface DeleteImageFileOptions {
  imageProjectId: string;
  filename: string;
  localOutputDir: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteImageFile(opts: DeleteImageFileOptions): Promise<void> {
  const { imageProjectId: ipId, filename, localOutputDir, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const safeFilename = filename.trim();

  // 1. 删除远程文件（幂等）
  try {
    await imageFetch(`/api/files/${ipId}/${encodeURIComponent(safeFilename)}`, { method: 'DELETE' });
  } catch {
    // 幂等：忽略
  }

  // 2. 删除本地副本
  const pathModule = await import('path');
  const fsModule = await import('fs');
  const localOutputDirResolved = pathModule.resolve(localOutputDir);
  const localPath = resolveSafePath(localOutputDirResolved, safeFilename);
  if (fsModule.existsSync(localPath)) {
    fsModule.unlinkSync(localPath);
  }

  log(agentId, '删除图片文件', `image_project_id=${ipId}, filename=${safeFilename}`, 'success');
}
