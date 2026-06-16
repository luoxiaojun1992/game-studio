/**
 * Video Service Client — FFmpeg 微服务 API 封装.
 *
 * 所有函数均为内部逻辑，供 tool 和 future backend API 共用。
 * 不直接依赖 agentId / logFn 等运行时上下文（由调用方注入）。
 */
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { resolveSafePath } from './db.js';
import type { AgentRole } from './agents.js';

const VIDEO_SERVICE_URL = process.env.VIDEO_SERVICE_URL || 'http://localhost:8084';

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

export async function videoFetch(path: string, init?: RequestInit): Promise<any> {
  const url = `${VIDEO_SERVICE_URL}${path}`;
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
    throw new Error(`Video API error ${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// 项目管理
// ---------------------------------------------------------------------------

export interface CreateVideoProjectOptions {
  projectId: string;   // studio project id（闭包锚点）
  name: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function createVideoProject(opts: CreateVideoProjectOptions): Promise<{ dbId: string; videoProjectId: string }> {
  const { projectId, name, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const now = new Date().toISOString();

  // 1. 调用 video service 创建项目目录（微服务内部生成 project_id）
  let videoProjectId: string;
  try {
    const res = await videoFetch('/api/projects', {
      method: 'POST',
    });
    videoProjectId = res?.project_id;
    if (!videoProjectId) {
      throw new Error('video service 未返回 project_id');
    }
  } catch (error: any) {
    throw new Error(`创建视频 project 失败：${error?.message || String(error)}`);
  }

  // 2. 在 backend DB 创建记录
  const dbId = uuidv4();
  db.createVideoProject({
    id: dbId,
    project_id: projectId,
    video_project_id: videoProjectId,
    name: name.trim(),
    created_at: now,
    updated_at: now,
  });

  log(agentId, '创建视频 project', `id=${dbId}, video_project_id=${videoProjectId}`, 'success');
  return { dbId, videoProjectId };
}

export function listVideoProjects(projectId: string, limit = 20): db.DbVideoProject[] {
  return db.getVideoProjects(projectId).slice(0, limit);
}

export interface DeleteVideoProjectOptions {
  projectId: string;
  videoProjectId: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteVideoProject(opts: DeleteVideoProjectOptions): Promise<void> {
  const { projectId, videoProjectId: vpId, agentId, logFn } = opts;
  const log = logFn || (() => {});

  // 1. 查询 DB 记录
  const records = db.getVideoProjects(projectId)
    .filter(r => r.video_project_id === vpId);
  const record = records[0];

  // 2. 调用 video service 删除（幂等）
  try {
    await videoFetch(`/api/projects/${vpId}`, { method: 'DELETE' });
  } catch {
    // 幂等：忽略
  }

  // 3. 删除 DB 记录
  if (record) {
    db.deleteVideoProject(record.id);
  }

  log(agentId, '删除视频 project', `video_project_id=${vpId}`, 'success');
}

// ---------------------------------------------------------------------------
// 视频操作
// ---------------------------------------------------------------------------

export interface VideoInfoResult {
  filename: string;
  size_bytes: number;
  duration: number;
  format_name?: string;
  bitrate?: string;
  width?: number;
  height?: number;
  codec?: string;
  fps?: number;
  has_audio?: boolean;
}

export async function videoGetInfo(opts: {
  videoProjectId: string;
  filename: string;
}): Promise<VideoInfoResult> {
  const { videoProjectId: vpId, filename } = opts;
  const res = await videoFetch(`/api/video/info?project_id=${vpId}&filename=${encodeURIComponent(filename.trim())}`);
  return res;
}

export interface VideoConvertOptions {
  videoProjectId: string;
  inputFilename: string;
  targetFormat: 'mp4' | 'webm' | 'mov' | 'gif' | 'avi' | 'mkv';
  outputFilename: string;
  videoCodec?: string;
  audioCodec?: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoConvert(opts: VideoConvertOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, targetFormat, outputFilename, videoCodec, audioCodec, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload: any = {
    input_filename: inputFilename.trim(),
    target_format: targetFormat,
    output_filename: outputFilename.trim(),
  };
  if (videoCodec) payload.video_codec = videoCodec;
  if (audioCodec) payload.audio_codec = audioCodec;

  const res = await videoFetch(`/api/video/convert?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '视频格式转换', `${targetFormat} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoTrimOptions {
  videoProjectId: string;
  inputFilename: string;
  startTime: number;
  duration?: number;
  endTime?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoTrim(opts: VideoTrimOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, startTime, duration, endTime, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload: any = {
    input_filename: inputFilename.trim(),
    start_time: startTime,
    output_filename: outputFilename.trim(),
  };
  if (duration !== undefined) payload.duration = duration;
  if (endTime !== undefined) payload.end_time = endTime;

  const res = await videoFetch(`/api/video/trim?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '视频截取', `from ${startTime}s "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoConcatOptions {
  videoProjectId: string;
  inputFilenames: string[];
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoConcat(opts: VideoConcatOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilenames, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filenames: inputFilenames.map(f => f.trim()),
    output_filename: outputFilename.trim(),
  };
  const res = await videoFetch(`/api/video/concat?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '视频拼接', `${inputFilenames.length} files -> "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoResizeOptions {
  videoProjectId: string;
  inputFilename: string;
  width: number;
  height: number;
  keepAspect?: boolean;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoResize(opts: VideoResizeOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, width, height, keepAspect = true, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    width,
    height,
    keep_aspect: keepAspect,
    output_filename: outputFilename.trim(),
  };
  const res = await videoFetch(`/api/video/resize?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '视频缩放', `${width}x${height} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoCompressOptions {
  videoProjectId: string;
  inputFilename: string;
  crf?: number;
  bitrate?: string;
  preset?: string;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoCompress(opts: VideoCompressOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, crf, bitrate, preset, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload: any = {
    input_filename: inputFilename.trim(),
    output_filename: outputFilename.trim(),
  };
  if (crf !== undefined) payload.crf = crf;
  if (bitrate) payload.bitrate = bitrate;
  if (preset) payload.preset = preset;

  const res = await videoFetch(`/api/video/compress?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '视频压缩', `crf=${crf} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoCropOptions {
  videoProjectId: string;
  inputFilename: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoCrop(opts: VideoCropOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, width, height, x = 0, y = 0, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    width,
    height,
    x,
    y,
    output_filename: outputFilename.trim(),
  };
  const res = await videoFetch(`/api/video/crop?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '视频裁剪', `${width}x${height}+${x}+${y} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoRotateOptions {
  videoProjectId: string;
  inputFilename: string;
  angle: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoRotate(opts: VideoRotateOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, angle, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    angle,
    output_filename: outputFilename.trim(),
  };
  const res = await videoFetch(`/api/video/rotate?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '视频旋转', `${angle}° "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoChangeSpeedOptions {
  videoProjectId: string;
  inputFilename: string;
  speed: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoChangeSpeed(opts: VideoChangeSpeedOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, speed, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    speed,
    output_filename: outputFilename.trim(),
  };
  const res = await videoFetch(`/api/video/change-speed?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '视频变速', `${speed}x "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoExtractFramesOptions {
  videoProjectId: string;
  inputFilename: string;
  fps?: number;
  frameCount?: number;
  outputPattern?: string;
  format?: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoExtractFrames(opts: VideoExtractFramesOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, fps, frameCount, outputPattern, format, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload: any = {
    input_filename: inputFilename.trim(),
  };
  if (fps !== undefined) payload.fps = fps;
  if (frameCount !== undefined) payload.frame_count = frameCount;
  if (outputPattern) payload.output_pattern = outputPattern;
  if (format) payload.format = format;

  const res = await videoFetch(`/api/video/extract-frames?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '提取帧', `${fps}fps "${inputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoExtractAudioOptions {
  videoProjectId: string;
  inputFilename: string;
  outputFilename: string;
  format?: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoExtractAudio(opts: VideoExtractAudioOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, outputFilename, format, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload: any = {
    input_filename: inputFilename.trim(),
    output_filename: outputFilename.trim(),
  };
  if (format) payload.format = format;

  const res = await videoFetch(`/api/video/extract-audio?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '提取音频', `"${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoAddAudioOptions {
  videoProjectId: string;
  videoFilename: string;
  audioFilename: string;
  outputFilename: string;
  mix?: boolean;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoAddAudio(opts: VideoAddAudioOptions): Promise<string> {
  const { videoProjectId: vpId, videoFilename, audioFilename, outputFilename, mix = false, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    video_filename: videoFilename.trim(),
    audio_filename: audioFilename.trim(),
    output_filename: outputFilename.trim(),
    mix,
  };
  const res = await videoFetch(`/api/video/add-audio?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '添加音频', `mix=${mix} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoAddTextOptions {
  videoProjectId: string;
  inputFilename: string;
  text: string;
  x?: number;
  y?: number;
  fontSize?: number;
  color?: string;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoAddText(opts: VideoAddTextOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, text, x = 10, y = 10, fontSize = 24, color = 'white', outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    text,
    x,
    y,
    font_size: fontSize,
    color,
    output_filename: outputFilename.trim(),
  };
  const res = await videoFetch(`/api/video/add-text?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '添加文字', `"${text.substring(0, 30)}" "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoAddWatermarkOptions {
  videoProjectId: string;
  inputFilename: string;
  watermarkFilename: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoAddWatermark(opts: VideoAddWatermarkOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, watermarkFilename, position = 'bottom-right', opacity = 0.5, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    watermark_filename: watermarkFilename.trim(),
    position,
    opacity,
    output_filename: outputFilename.trim(),
  };
  const res = await videoFetch(`/api/video/add-watermark?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '添加水印', `${position} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoGenerateGifOptions {
  videoProjectId: string;
  inputFilename: string;
  fps?: number;
  width?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoGenerateGif(opts: VideoGenerateGifOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, fps, width, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload: any = {
    input_filename: inputFilename.trim(),
    output_filename: outputFilename.trim(),
  };
  if (fps !== undefined) payload.fps = fps;
  if (width !== undefined) payload.width = width;

  const res = await videoFetch(`/api/video/generate-gif?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '生成GIF', `${fps}fps "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoGifToVideoOptions {
  videoProjectId: string;
  inputFilename: string;
  targetFormat?: string;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoGifToVideo(opts: VideoGifToVideoOptions): Promise<string> {
  const { videoProjectId: vpId, inputFilename, targetFormat = 'mp4', outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    input_filename: inputFilename.trim(),
    target_format: targetFormat,
    output_filename: outputFilename.trim(),
  };
  const res = await videoFetch(`/api/video/gif-to-video?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, 'GIF转视频', `${targetFormat} "${outputFilename}"`, 'success');
  return res?.output || '';
}

export interface VideoCreateThumbnailOptions {
  videoProjectId: string;
  filename: string;
  time?: number;
  width?: number;
  outputFilename: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function videoCreateThumbnail(opts: VideoCreateThumbnailOptions): Promise<string> {
  const { videoProjectId: vpId, filename, time, width, outputFilename, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload: any = {
    filename: filename.trim(),
    output_filename: outputFilename.trim(),
  };
  if (time !== undefined) payload.time = time;
  if (width !== undefined) payload.width = width;

  const res = await videoFetch(`/api/video/create-thumbnail?project_id=${vpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  log(agentId, '生成缩略图', `"${outputFilename}"`, 'success');
  return res?.output || '';
}

// ---------------------------------------------------------------------------
// 文件管理
// ---------------------------------------------------------------------------

export { VIDEO_SERVICE_URL };

export interface UploadVideoFileOptions {
  videoProjectId: string;
  filename: string;
  content: string;        // base64 编码的视频内容
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function uploadVideoFile(opts: UploadVideoFileOptions): Promise<{ sizeBytes: number }> {
  const { videoProjectId: vpId, filename, content, agentId, logFn } = opts;
  const log = logFn || (() => {});

  const res = await videoFetch(`/api/files/${vpId}/${encodeURIComponent(filename.trim())}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });

  const sizeBytes = res?.size_bytes || 0;
  log(agentId, '上传视频文件', `${filename} -> video-project=${vpId}, size=${sizeBytes}`, 'success');
  return { sizeBytes };
}

export interface DownloadVideoFileOptions {
  videoProjectId: string;
  filename: string;
  localOutputDir: string;  // 绝对路径
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function downloadVideoFile(opts: DownloadVideoFileOptions): Promise<{ localPath: string; sizeBytes: number }> {
  const { videoProjectId: vpId, filename, localOutputDir, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const safeFilename = filename.trim();

  // 先检查文件是否存在
  const fileList: any = await videoFetch(`/api/files/${vpId}`);
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

  const downloadRes = await fetch(`${VIDEO_SERVICE_URL}/api/files/${vpId}/${encodeURIComponent(safeFilename)}`);
  if (!downloadRes.ok) {
    throw new Error(`下载失败：HTTP ${downloadRes.status}`);
  }
  const buffer = await downloadRes.arrayBuffer();
  fsModule.writeFileSync(localPath, Buffer.from(buffer));

  log(agentId, '下载视频文件', `${safeFilename} -> ${localPath}`, 'success');
  return { localPath, sizeBytes: found.size_bytes };
}

export interface DeleteVideoFileOptions {
  videoProjectId: string;
  filename: string;
  localOutputDir: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteVideoFile(opts: DeleteVideoFileOptions): Promise<void> {
  const { videoProjectId: vpId, filename, localOutputDir, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const safeFilename = filename.trim();

  // 1. 删除远程文件（幂等）
  try {
    await videoFetch(`/api/files/${vpId}/${encodeURIComponent(safeFilename)}`, { method: 'DELETE' });
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

  log(agentId, '删除视频文件', `video_project_id=${vpId}, filename=${safeFilename}`, 'success');
}
