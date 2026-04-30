/**
 * Drawio Service Client — Draw.io 图表微服务 API 封装.
 *
 * 所有函数均为内部逻辑，供 tool 和 future backend API 共用。
 * 不直接依赖 agentId / logFn 等运行时上下文（由调用方注入）。
 */
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { resolveSafePath } from './db.js';
import type { AgentRole } from './agents.js';

const DRAWIO_SERVICE_URL = process.env.DRAWIO_SERVICE_URL || 'http://localhost:8082';

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

export async function drawioFetch(path: string, init?: RequestInit): Promise<any> {
  const url = `${DRAWIO_SERVICE_URL}${path}`;
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
    throw new Error(`Drawio API error ${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// 项目管理
// ---------------------------------------------------------------------------

export interface CreateDrawioProjectOptions {
  projectId: string;   // studio project id（闭包锚点）
  drawioProjectId?: string;  // 可选，默认 uuidv4
  name: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function createDrawioProject(opts: CreateDrawioProjectOptions): Promise<{ dbId: string; drawioProjectId: string }> {
  const { projectId, drawioProjectId: maybeDpId, name, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const now = new Date().toISOString();
  const dbId = uuidv4();
  const drawioProjectId = maybeDpId || uuidv4();

  // 1. 在 backend DB 创建记录
  const record = db.createDrawioProject({
    id: dbId,
    project_id: projectId,
    drawio_project_id: drawioProjectId,
    name: name.trim(),
    created_at: now,
    updated_at: now,
  });

  // 2. 调用 drawio service 创建项目目录
  try {
    const res = await drawioFetch(`/api/projects/${drawioProjectId}`, {
      method: 'POST',
    });
    const returnedId: string = res?.project_id || drawioProjectId;
    if (returnedId !== drawioProjectId) {
      db.updateDrawioProject(dbId, { drawio_project_id: returnedId });
    }
    log(agentId, '创建图表 project', `id=${dbId}, drawio_project_id=${returnedId}`, 'success');
    return { dbId, drawioProjectId: returnedId };
  } catch (error: any) {
    db.deleteDrawioProject(dbId);
    throw new Error(`创建图表 project 失败：${error?.message || String(error)}`);
  }
}

export function listDrawioProjects(projectId: string, limit = 20): db.DbDrawioProject[] {
  return db.getDrawioProjects(projectId).slice(0, limit);
}

export interface DeleteDrawioProjectOptions {
  projectId: string;
  drawioProjectId: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function deleteDrawioProject(opts: DeleteDrawioProjectOptions): Promise<void> {
  const { projectId, drawioProjectId: dpId, agentId, logFn } = opts;
  const log = logFn || (() => {});

  // 1. 查询 DB 记录
  const records = db.getDrawioProjects(projectId)
    .filter(r => r.drawio_project_id === dpId);
  const record = records[0];

  // 2. 调用 drawio service 删除（幂等）
  try {
    await drawioFetch(`/api/projects/${dpId}`, { method: 'DELETE' });
  } catch {
    // 幂等：忽略（404 也算删除成功）
  }

  // 3. 删除 DB 记录
  if (record) {
    db.deleteDrawioProject(record.id);
  }

  log(agentId, '删除图表 project', `drawio_project_id=${dpId}`, 'success');
}

// ---------------------------------------------------------------------------
// 图表操作
// ---------------------------------------------------------------------------

export type ShapeType = 'rectangle' | 'ellipse' | 'diamond' | 'parallelogram' | 'hexagon' | 'cylinder' | 'cloud' | 'process' | 'decision' | 'document' | 'person' | 'database';
export type ConnectorType = 'straight' | 'orthogonal' | 'elbow' | 'curved';
export type ExportFormat = 'png' | 'svg' | 'pdf' | 'xml';

export interface ShapeStyle {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface ConnectorStyle {
  strokeColor?: string;
  strokeWidth?: number;
}

export interface DrawioCreateDiagramOptions {
  drawioProjectId: string;
  name: string;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function createDiagram(opts: DrawioCreateDiagramOptions): Promise<{ diagramId: string }> {
  const { drawioProjectId: dpId, name, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    name: name.trim(),
  };
  const res = await drawioFetch(`/api/diagrams/${dpId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const diagramId: string = res?.diagram_id || '';
  log(agentId, '创建图表', `"${name}" (diagram_id: ${diagramId})`, 'success');
  return { diagramId };
}

export interface DrawioAddShapeOptions {
  drawioProjectId: string;
  diagramId: string;
  shapeType: ShapeType;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  style?: ShapeStyle;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function addShape(opts: DrawioAddShapeOptions): Promise<string> {
  const { drawioProjectId: dpId, diagramId, shapeType, label, x, y, width, height, style, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    shape_type: shapeType,
    label: label.trim(),
    x,
    y,
    width: width || 120,
    height: height || 60,
    style: style || {},
  };
  const res = await drawioFetch(`/api/diagrams/${dpId}/${diagramId}/shapes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const shapeId: string = res?.shape_id || '';
  log(agentId, '添加形状', `${shapeType} "${label}" (shape_id: ${shapeId})`, 'success');
  return shapeId;
}

export interface DrawioAddConnectorOptions {
  drawioProjectId: string;
  diagramId: string;
  fromShapeId: string;
  toShapeId: string;
  label?: string;
  connectorType?: ConnectorType;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  style?: ConnectorStyle;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function addConnector(opts: DrawioAddConnectorOptions): Promise<string> {
  const { drawioProjectId: dpId, diagramId, fromShapeId, toShapeId, label, connectorType, arrowStart, arrowEnd, style, agentId, logFn } = opts;
  const log = logFn || (() => {});
  const payload = {
    from_shape_id: fromShapeId.trim(),
    to_shape_id: toShapeId.trim(),
    label: label?.trim() || '',
    connector_type: connectorType || 'straight',
    arrow_start: arrowStart ?? false,
    arrow_end: arrowEnd ?? true,
    style: style || {},
  };
  const res = await drawioFetch(`/api/diagrams/${dpId}/${diagramId}/connectors`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const connectorId: string = res?.connector_id || '';
  log(agentId, '添加连接线', `${fromShapeId} → ${toShapeId} (connector_id: ${connectorId})`, 'success');
  return connectorId;
}

export interface DrawioExportOptions {
  drawioProjectId: string;
  diagramId: string;
  format: ExportFormat;
  scale?: number;
  transparent?: boolean;
}

export async function exportDiagram(opts: DrawioExportOptions): Promise<Buffer> {
  const { drawioProjectId: dpId, diagramId, format, scale, transparent } = opts;
  const params = new URLSearchParams({
    format,
    ...(scale ? { scale: String(scale) } : {}),
    ...(transparent !== undefined ? { transparent: String(transparent) } : {}),
  });
  const url = `${DRAWIO_SERVICE_URL}/api/export/${dpId}/${diagramId}?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Export failed: HTTP ${res.status} - ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// 文件管理
// ---------------------------------------------------------------------------

export { DRAWIO_SERVICE_URL };

export interface DownloadDiagramOptions {
  drawioProjectId: string;
  diagramId: string;
  localOutputDir: string;
  filename?: string;
  format?: ExportFormat;
  agentId: AgentRole;
  logFn?: (agentId: AgentRole, action: string, detail: string, level: 'info' | 'warn' | 'error' | 'success') => void;
}

export async function downloadDiagram(opts: DownloadDiagramOptions): Promise<{ localPath: string; sizeBytes: number }> {
  const { drawioProjectId: dpId, diagramId, localOutputDir, filename, format = 'png', agentId, logFn } = opts;
  const log = logFn || (() => {});
  const safeFilename = (filename || `${diagramId}.${format}`).trim();

  // 下载文件到 backend output 目录
  const pathModule = await import('path');
  const fsModule = await import('fs');

  const outputDir = pathModule.resolve(localOutputDir);
  if (!fsModule.existsSync(outputDir)) {
    fsModule.mkdirSync(outputDir, { recursive: true });
  }
  // 路径安全校验
  const localPath = resolveSafePath(outputDir, safeFilename);

  const buffer = await exportDiagram({
    drawioProjectId: dpId,
    diagramId,
    format,
  });

  fsModule.writeFileSync(localPath, buffer);

  log(agentId, '下载图表', `${safeFilename} -> ${localPath}`, 'success');
  return { localPath, sizeBytes: buffer.length };
}

// ---------------------------------------------------------------------------
// 元素列表
// ---------------------------------------------------------------------------

export interface DiagramElementInfo {
  elementId: string;
  elementType: 'shape' | 'connector';
  label: string;
  style: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  sourceId?: string;
  targetId?: string;
}

export interface ListElementsResult {
  elements: DiagramElementInfo[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDiagramElements(opts: {
  drawioProjectId: string;
  diagramId: string;
  page?: number;
  pageSize?: number;
  elementType?: 'shape' | 'connector';
}): Promise<ListElementsResult> {
  const { drawioProjectId: dpId, diagramId, page = 1, pageSize = 20, elementType } = opts;

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (elementType) {
    params.set('element_type', elementType);
  }

  const res = await drawioFetch(
    `/api/diagrams/${dpId}/${diagramId}/elements?${params}`,
  );

  // 将 snake_case 转为 camelCase
  const elements: DiagramElementInfo[] = (res?.elements || []).map((e: any) => ({
    elementId: e.element_id,
    elementType: e.element_type,
    label: e.label,
    style: e.style,
    x: e.x,
    y: e.y,
    width: e.width,
    height: e.height,
    sourceId: e.source_id,
    targetId: e.target_id,
  }));

  return {
    elements,
    total: res?.total ?? 0,
    page: res?.page ?? page,
    pageSize: res?.page_size ?? pageSize,
  };
}
