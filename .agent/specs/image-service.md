# ImageMagick 图片处理微服务规范

> **SPEC-008** | 状态：设计中

## 目标

构建 ImageMagick 图片处理微服务（`image-service`），为 game-studio 提供游戏素材批量处理能力。架构完全复刻现有 creator service (Blender) 模式：独立 FastAPI 容器 → HTTP → TS 客户端 → MCP 工具（仅 engineer 可用）。

## 架构概述

```
image-service/ (FastAPI + ImageMagick, port 8083)
├── app/main.py           # FastAPI entrypoint + /health
├── app/schemas.py        # Pydantic 请求/响应模型
├── app/imagemagick.py    # ImageMagick subprocess 执行器
├── app/operations.py     # 命令行参数生成器
├── app/safe_path.py      # 路径遍历防护
├── app/routers/
│   ├── project.py        # 项目 CRUD（同 creator 模式）
│   ├── image.py          # 12 个图片操作端点
│   └── file.py           # 文件列表/下载/删除
├── requirements.txt
└── Dockerfile (alpine:3.21 + imagemagick, ~50MB)

server/
├── image-service.ts      # TS 客户端 (imageFetch, createImageProject, ...)
├── image-service.d.ts    # TypeScript 类型定义
├── tools.ts              # MCP 工具注册 (image_resize, image_convert, ...)
├── db.ts                 # SQLite image_projects 表
├── agent-manager.ts      # ENGINEER_ALLOW 权限
└── agents.ts             # 系统提示词 + TOOLS_OVERVIEW
```

### 与 Creator Service 的对照

| 维度 | Creator (Blender) | Image Service (ImageMagick) |
|------|-------------------|---------------------------|
| 镜像 | ubuntu:24.04 + Blender 4.2 | alpine:3.21 + ImageMagick 7 |
| 镜像大小 | ~2GB+ | ~50MB |
| 端口 | 8080 | 8083 |
| 核心二进制 | `/opt/blender/blender` | `magick` |
| 执行方式 | `blender --background --python-expr <script>` | `magick <args>` |
| 项目存储 | `/app/data/projects/{id}` | 同 |
| 超时 | 120s | 60s（图片操作更快） |
| 操作层 | 生成 Blender Python 脚本字符串 | 生成 ImageMagick CLI 参数数组 |

## API 设计

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{project_id}` | 创建项目目录（幂等） |
| GET | `/api/projects/{project_id}` | 查询项目状态 |
| DELETE | `/api/projects/{project_id}` | 删除项目目录（幂等） |

### 图片操作（全部 POST）

| 端点 | 说明 | 关键参数 |
|------|------|---------|
| `/api/image/resize` | 缩放 | `input_filename`, `width`, `height`, `keep_aspect`, `output_filename` |
| `/api/image/crop` | 裁剪 | `input_filename`, `width`, `height`, `x`, `y`, `output_filename` |
| `/api/image/convert` | 格式转换 | `input_filename`, `target_format`, `output_filename` |
| `/api/image/compress` | 压缩 | `input_filename`, `quality`, `output_filename` |
| `/api/image/watermark` | 水印 | `input_filename`, `type`, `content/text`, `position`, `opacity`, `output_filename` |
| `/api/image/composite` | 合成 | `base_filename`, `overlay_filename`, `gravity`, `x`, `y`, `output_filename` |
| `/api/image/flip-rotate` | 翻转/旋转 | `input_filename`, `mode`, `angle`, `output_filename` |
| `/api/image/add-margin` | 边距 | `input_filename`, `top`, `right`, `bottom`, `left`, `color`, `output_filename` |
| `/api/image/color-adjust` | 色彩调整 | `input_filename`, `brightness`, `contrast`, `saturation`, `hue`, `output_filename` |
| `/api/image/info` | 图片信息 | `filename`（返回尺寸、格式、色彩空间、文件大小） |
| `/api/image/batch` | 批量处理 | `input_pattern`, `operation`, `operation_params`, `output_dir` |
| `/api/image/sprite-sheet` | 精灵图拼合 | `files`, `columns`, `rows`, `output_filename` |

### 文件管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/{project_id}` | 列出项目文件 |
| GET | `/api/files/{project_id}/{filename}` | 下载文件 |
| DELETE | `/api/files/{project_id}/{filename}` | 删除文件（幂等） |

### 通用响应格式

```json
// 操作成功
{
  "success": true,
  "output": "stdout 日志",
  "message": "操作描述",
  "output_file": "output_filename"
}

// 操作失败 (422)
{
  "detail": "ImageMagick error: ...\nSTDERR: ..."
}
```

## 输入校验规则

| 字段 | 规则 |
|------|------|
| `project_id` | 正则 `/^[a-zA-Z0-9_-]{1,64}$/` |
| `filename` | 正则 `/^[a-zA-Z0-9_.\-]+$/`，拒绝路径分隔符 |
| `width` / `height` | 正整数，1-16384 |
| `quality` | 1-100 |
| `target_format` | Literal: `"png"`, `"jpg"`, `"webp"`, `"avif"`, `"gif"`, `"bmp"` |
| `gravity` | Literal: `"center"`, `"north"`, `"south"`, `"east"`, `"west"`, `"northeast"`, `"northwest"`, `"southeast"`, `"southwest"` |
| `mode` (flip-rotate) | Literal: `"flip"`, `"flop"`, `"rotate"`, `"transpose"`, `"transverse"` |
| `opacity` | 0.0-1.0 |
| `brightness` / `contrast` | -100 到 100 |
| `saturation` | 0-200（100=原值） |
| `hue` | 0-200（100=原值） |

## ImageMagick 命令映射

| 操作 | 命令示例 |
|------|---------|
| resize | `magick input.png -resize 256x256 output.png` |
| crop | `magick input.png -crop 128x128+32+32 output.png` |
| convert | `magick input.png output.webp` |
| compress | `magick input.png -quality 80 output.jpg` |
| watermark (text) | `magick input.png -font Arial -pointsize 24 -fill "rgba(255,255,255,0.5)" -annotate +10+10 "watermark" output.png` |
| composite | `magick base.png overlay.png -gravity center -composite output.png` |
| rotate | `magick input.png -rotate 90 output.png` |
| add-margin | `magick input.png -bordercolor transparent -border 10x20 output.png` |
| color-adjust | `magick input.png -brightness-contrast 10x5 -modulate 100,150,100 output.png` |
| info | `magick identify -verbose input.png` |
| sprite-sheet | `magick montage frame*.png -tile 4x4 -geometry 64x64+0+0 -background none spritesheet.png` |

## 数据模型

### `image_projects` 表（SQLite）

```sql
CREATE TABLE IF NOT EXISTS image_projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  image_project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_projects_project ON image_projects(project_id);
```

结构与 `blender_projects` 完全一致，仅表名和列名替换。

## MCP 工具清单（17 个）

所有工具仅 **engineer** 可用，无需审批，`ENGINEER_ALLOW` 自动放行。

| 工具名 | 说明 |
|--------|------|
| `image_create_project` | 创建图片处理 project |
| `image_list_projects` | 列出图片 project |
| `image_delete_project` | 删除图片 project |
| `image_resize` | 缩放图片 |
| `image_crop` | 裁剪图片 |
| `image_convert` | 格式转换 (PNG↔JPG↔WEBP↔AVIF) |
| `image_compress` | 压缩（质量控制） |
| `image_watermark` | 添加文字/图片水印 |
| `image_composite` | 图片合成叠加 |
| `image_flip_rotate` | 翻转/旋转 |
| `image_add_margin` | 添加边距（透明通道拓展） |
| `image_color_adjust` | 色彩调整 |
| `image_info` | 获取图片元信息 |
| `image_batch` | 批量处理 |
| `image_sprite_sheet` | 精灵图拼合 |
| `image_download_file` | 下载文件到本地 |
| `image_delete_file` | 删除远程文件 |

## 集成要点

### Docker Compose

```yaml
image-service:
  build:
    context: ./image-service
    dockerfile: Dockerfile
  container_name: game-studio-image-service
  ports:
    - "${IMAGE_SERVICE_PORT:-8083}:8083"
  environment:
    - IMAGE_SERVICE_PORT=8083
  volumes:
    - image-data:/app/data
  networks:
    - game-studio-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8083/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 10s
  restart: unless-stopped
```

Backend 环境变量：
```
IMAGE_SERVICE_URL=http://image-service:8083
```

### 导出路径安全

图片处理工具生成的输出文件，导出到本地时路径限制在 `/app/output/{projectId}/games/latest/` 下，使用 `resolveSafePath` + `startsWith` 双重校验。

### 成本

- 镜像体积 ~50MB（Alpine + ImageMagick）
- 无需 GPU，纯 CPU 运算
- 图片处理操作超时 60s，批量处理超时 300s

## 相关文件

| 文件 | 角色 |
|------|------|
| `image-service/Dockerfile` | 容器构建 |
| `image-service/requirements.txt` | Python 依赖 |
| `image-service/app/main.py` | FastAPI 入口 |
| `image-service/app/schemas.py` | Pydantic 模型 |
| `image-service/app/imagemagick.py` | ImageMagick subprocess 执行器 |
| `image-service/app/operations.py` | CLI 参数生成器 |
| `image-service/app/safe_path.py` | 路径安全 |
| `image-service/app/routers/project.py` | 项目路由 |
| `image-service/app/routers/image.py` | 图片操作路由 |
| `image-service/app/routers/file.py` | 文件管理路由 |
| `server/image-service.ts` | TS HTTP 客户端 |
| `server/image-service.d.ts` | TS 类型定义 |
| `server/db.ts` | image_projects 表 + CRUD |
| `server/tools.ts` | 17 个 MCP 工具 |
| `server/agent-manager.ts` | ENGINEER_ALLOW 权限 |
| `server/agents.ts` | TOOLS_OVERVIEW + 系统提示词 |
| `docker-compose.yml` | image-service 容器 |
| `docker-compose.ui-test.yml` | ui-test 容器 |

## 测试策略

1. **单元测试**：`imagemagick.py` 和 `operations.py` 独立测试
2. **集成测试**：docker-compose 中拉起 image-service 容器，curl 调用各端点
3. **UI Test**：通过 engineer agent 调用 image_* 工具，验证全链路

> **注意**：ImageMagick 在 Alpine 中安装为 `imagemagick` 包，命令为 `magick`（IM7），非旧版 `convert`（IM6）。

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

新增前端交互功能（按钮、表单、弹窗、面板等）时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
1. `tests/ui/e2e/studio.spec.ts` — 添加测试用例（分配下一个 UI-XXX 编号）
2. `.agent/memory/E2E_TESTING.md` — 更新测试矩阵、testid 对照表、测试经验
3. `.agent/specs/` 下对应的 spec 文档 — 更新测试策略章节
4. `.agent/specs/INDEX.md` — 如有新 spec 则更新索引

## 主动更新所有相关文档规范

实现新功能或做重大修改后，必须主动检查并更新所有受影响的文档，而非仅更新直接相关文件。完整检查清单：
1. `README.md` + `README.zh-CN.md` — 功能概览、API 概览、目录结构
2. `docs/ARCHITECTURE.md` + `docs/ARCHITECTURE.zh-CN.md` — 业务域、数据模型、运行时组件
3. `.agent/memory/ARCHITECTURE.md` — 架构关键点、关键模块详解
4. `.agent/memory/INDEX.md` — 快速参考
5. `.agent/memory/E2E_TESTING.md` — 测试矩阵、testid 对照表（如有新测试）
6. `.agent/memory/CONVENTIONS.md` — 工作约定（如有新规范）
7. `.agent/memory/MEMORY.md` — 长期记忆（工程决策记录）
8. `.agent/specs/` 下相关 spec 文档 — 状态、测试策略
9. `.agent/specs/INDEX.md` — spec 索引状态
10. `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` — 关键文件位置、API 概览
- **文档更新禁止添加日期和敏感信息**
- **不相关的文档不需要修改**（如 LINT.md 与本功能无关则不更新）

## 详细 Debug 日志规范

新增前端交互功能、后端 API 路由、E2E 测试用例时，必须同步添加 `console.log` / `process.stderr.write` debug 日志，方便测试失败时快速定位问题：

1. **后端 API 路由**：在路由入口、校验步骤（PASS/FAIL）、关键操作（DB 写入、SSE 广播）处添加 `console.log('[DEBUG:路由名] stepN: ...')` 格式日志
2. **前端组件**：在关键生命周期（mount）、用户操作（表单填写、校验、提交）、API 请求/响应处添加 `console.log('[DEBUG:ComponentName] ...')` 格式日志
3. **SSE 事件处理**：在 `handleSSEEvent` 的 case 分支中添加日志，记录事件类型和关键数据
4. **E2E 测试用例**：参照 UI-007/008 的 `log()` helper 模式，每个操作步骤添加 `process.stderr.write('[UI-XXX] step: ...')` 日志，包含结构化 extra 数据
   - **日志格式统一**：`[DEBUG:模块名] stepN: 描述` 或 `[UI-XXX] stepN: 描述`，关键数据以 JSON extra 输出
   - **日志粒度**：关键路径全覆盖，但避免在循环/高频回调中输出日志
