# FFmpeg 视频处理微服务规范

## 目标

构建 FFmpeg 视频处理微服务（`video-service`），为 game-studio 提供游戏视频素材处理能力（宣传片剪辑、录屏转 GIF、帧提取等）。架构完全复刻现有 creator service (Blender) 和 image service (ImageMagick) 模式：独立 FastAPI 容器 → HTTP → TS 客户端 → MCP 工具（仅 engineer 可用）。

## 架构概述

```
video-service/ (FastAPI + FFmpeg, port 8084)
├── app/main.py           # FastAPI entrypoint + /health
├── app/schemas.py        # Pydantic 请求/响应模型
├── app/ffmpeg.py         # FFmpeg subprocess 执行器
├── app/operations.py     # FFmpeg 命令行参数生成器
├── app/safe_path.py      # 路径遍历防护
├── app/routers/
│   ├── project.py        # 项目 CRUD（同 creator 模式）
│   ├── video.py          # 17 个视频操作端点
│   └── file.py           # 文件列表/下载/删除
├── requirements.txt
└── Dockerfile (alpine:3.21 + ffmpeg, ~120MB)

server/
├── video-service.ts      # TS 客户端 (videoFetch, createVideoProject, ...)
├── video-service.d.ts    # TypeScript 类型定义
├── tools.ts              # MCP 工具注册 (video_convert, video_trim, ...)
├── db.ts                 # SQLite video_projects 表
├── agent-manager.ts      # ENGINEER_ALLOW 权限
└── agents.ts             # 系统提示词 + TOOLS_OVERVIEW
```

### 与 Creator / Image Service 的对照

| 维度 | Creator (Blender) | Image Service (ImageMagick) | Video Service (FFmpeg) |
|------|-------------------|---------------------------|------------------------|
| 镜像 | ubuntu:24.04 + Blender 4.2 | alpine:3.21 + ImageMagick 7 | alpine:3.21 + FFmpeg 6 |
| 镜像大小 | ~2GB+ | ~50MB | ~120MB |
| 端口 | 8080 | 8083 | 8084 |
| 核心二进制 | `/opt/blender/blender` | `magick` | `ffmpeg` |
| 执行方式 | `blender --background --python-expr <script>` | `magick <args>` | `ffmpeg -i input <filters> output` |
| 项目存储 | `/app/data/projects/{id}` | 同 | 同 |
| 超时 | 120s | 60s | 300s（视频处理更耗时） |
| 操作层 | 生成 Blender Python 脚本字符串 | 生成 ImageMagick CLI 参数数组 | 生成 FFmpeg 命令行参数数组 |

## API 设计

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{project_id}` | 创建项目目录（幂等） |
| GET | `/api/projects/{project_id}` | 查询项目状态 |
| DELETE | `/api/projects/{project_id}` | 删除项目目录（幂等） |

### 视频操作（全部 POST）

| 端点 | 说明 | 关键参数 |
|------|------|---------|
| `/api/video/info` | 视频元信息 | `filename`（返回时长、分辨率、编码、码率、帧率、音频流信息） |
| `/api/video/convert` | 格式转换 | `input_filename`, `target_format`, `output_filename`, `video_codec`, `audio_codec` |
| `/api/video/trim` | 截取片段 | `input_filename`, `start_time`, `duration` / `end_time`, `output_filename` |
| `/api/video/concat` | 拼接视频 | `input_filenames[]`, `output_filename` |
| `/api/video/resize` | 缩放/改分辨率 | `input_filename`, `width`, `height`, `keep_aspect`, `output_filename` |
| `/api/video/compress` | 压缩（码率控制） | `input_filename`, `crf` / `bitrate`, `preset`, `output_filename` |
| `/api/video/crop` | 画面裁剪 | `input_filename`, `width`, `height`, `x`, `y`, `output_filename` |
| `/api/video/rotate` | 旋转 | `input_filename`, `angle`, `output_filename` |
| `/api/video/change_speed` | 变速 | `input_filename`, `speed`, `output_filename` |
| `/api/video/extract_frames` | 提取帧为图片 | `input_filename`, `fps` / `frame_count`, `output_pattern`, `format` |
| `/api/video/extract_audio` | 提取音频 | `input_filename`, `output_filename`, `format` |
| `/api/video/add_audio` | 添加/替换音轨 | `video_filename`, `audio_filename`, `output_filename`, `mix` |
| `/api/video/add_text` | 添加文字叠加 | `input_filename`, `text`, `position` (`x`, `y`), `font_size`, `color`, `output_filename` |
| `/api/video/add_watermark` | 添加图片水印 | `input_filename`, `watermark_filename`, `position`, `opacity`, `output_filename` |
| `/api/video/generate_gif` | 视频转 GIF | `input_filename`, `fps`, `width`, `output_filename` |
| `/api/video/gif_to_video` | GIF 转视频 | `input_filename`, `target_format`, `output_filename` |
| `/api/video/create_thumbnail` | 生成缩略图 | `filename`, `time`, `width`, `output_filename` |

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
  "output_file": "output_filename",
  "info": {
    "duration": 12.5,
    "width": 1920,
    "height": 1080,
    "codec": "h264",
    "fps": 30,
    "bitrate": "2500kbps",
    "has_audio": true
  }
}

// 操作失败 (422)
{
  "detail": "FFmpeg error: ...\nSTDERR: ..."
}
```

> `info` 字段仅在 `video_info` 请求中返回完整数据，其他操作可选返回部分字段（如转换后的文件大小）。

## 输入校验规则

| 字段 | 规则 |
|------|------|
| `project_id` | 正则 `/^[a-zA-Z0-9_-]{1,64}$/` |
| `filename` | 正则 `/^[a-zA-Z0-9_./\-]+$/`，拒绝路径分隔符 `..` |
| `width` / `height` | 正整数，1-7680（8K 上限） |
| `start_time` | 浮点数，≥ 0 |
| `duration` | 浮点数，> 0 |
| `end_time` | 浮点数，> `start_time` |
| `crf` | 0-51（H.264/H.265 默认 23，越小质量越高） |
| `bitrate` | non-empty string，如 `"1M"`, `"2500k"` |
| `fps` | 正整数，1-120 |
| `speed` | 浮点数，0.25-4.0（0.25x 到 4x） |
| `angle` | 0, 90, 180, 270 |
| `target_format` | Literal: `"mp4"`, `"webm"`, `"mov"`, `"gif"`, `"avi"`, `"mkv"` |
| `video_codec` | Literal: `"h264"`, `"h265"`, `"vp8"`, `"vp9"`, `"av1"`, `null`（auto 选最佳） |
| `audio_codec` | Literal: `"aac"`, `"mp3"`, `"opus"`, `"vorbis"`, `"copy"`, `null`（auto） |
| `preset` | Literal: `"ultrafast"`, `"superfast"`, `"veryfast"`, `"faster"`, `"fast"`, `"medium"`, `"slow"`, `"slower"`, `"veryslow"` |
| `opacity` | 0.0-1.0 |
| `color` (add_text) | Hex 颜色如 `"#FFFFFF"` 或 `"white"` |
| `keep_aspect` | boolean |
| `mix` (add_audio) | boolean，true=混合原音频和新音频，false=替换 |
| `position` (watermark) | Literal: `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`, `"center"` |

## FFmpeg 命令映射

| 操作 | 命令示例 |
|------|---------|
| info | `ffprobe -v quiet -print_format json -show_format -show_streams input.mp4` |
| convert | `ffmpeg -i input.mp4 -c:v libx264 -c:a aac output.mp4` |
| trim | `ffmpeg -ss 00:00:05 -i input.mp4 -t 00:00:10 -c copy output.mp4` |
| concat | `ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4`（需先生成 filelist.txt） |
| resize | `ffmpeg -i input.mp4 -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" output.mp4` |
| compress | `ffmpeg -i input.mp4 -c:v libx264 -crf 28 -preset veryslow output.mp4` |
| crop | `ffmpeg -i input.mp4 -vf "crop=640:480:100:50" output.mp4` |
| rotate | `ffmpeg -i input.mp4 -vf "transpose=1" output.mp4`（90°、180°、270° 用不同 transpose 值或 rotate filter） |
| change_speed | `ffmpeg -i input.mp4 -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]" -map "[v]" -map "[a]" output.mp4` |
| extract_frames | `ffmpeg -i input.mp4 -vf "fps=1" frame_%04d.png` |
| extract_audio | `ffmpeg -i input.mp4 -vn -c:a copy output.mp3` |
| add_audio | `ffmpeg -i video.mp4 -i audio.mp3 -c:v copy -c:a aac -shortest output.mp4`（mix=true 用 amix filter） |
| add_text | `ffmpeg -i input.mp4 -vf "drawtext=text='Hello':fontsize=24:fontcolor=white:x=10:y=10" output.mp4` |
| add_watermark | `ffmpeg -i input.mp4 -i watermark.png -filter_complex "[1:v]format=rgba,colorchannelmixer=aa=0.5[wm];[0:v][wm]overlay=W-w-10:H-h-10" output.mp4` |
| generate_gif | `ffmpeg -i input.mp4 -vf "fps=10,scale=480:-1:flags=lanczos" -loop 0 output.gif` |
| gif_to_video | `ffmpeg -i input.gif -c:v libx264 -pix_fmt yuv420p output.mp4` |
| create_thumbnail | `ffmpeg -ss 00:00:05 -i input.mp4 -vframes 1 -vf "scale=320:-1" thumbnail.jpg` |

## 数据模型

### `video_projects` 表（SQLite）

```sql
CREATE TABLE IF NOT EXISTS video_projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  video_project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_projects_project ON video_projects(project_id);
```

结构与 `blender_projects` / `image_projects` 完全一致，仅表名和列名替换。

## MCP 工具清单（20 个）

所有工具仅 **engineer** 可用，无需审批，`ENGINEER_ALLOW` 自动放行。

| 工具名 | 说明 |
|--------|------|
| `video_create_project` | 创建视频处理 project |
| `video_list_projects` | 列出视频 project |
| `video_delete_project` | 删除视频 project |
| `video_info` | 获取视频元信息（时长、分辨率、编码等） |
| `video_convert` | 格式转换（MP4 ↔ WebM ↔ MOV） |
| `video_trim` | 截取视频片段 |
| `video_concat` | 拼接多个视频 |
| `video_resize` | 缩放/改变分辨率 |
| `video_compress` | 压缩（CRF 或码率控制） |
| `video_crop` | 画面裁剪 |
| `video_rotate` | 旋转（90°/180°/270°） |
| `video_change_speed` | 变速（0.25x ~ 4x） |
| `video_extract_frames` | 提取帧为图片序列 |
| `video_extract_audio` | 提取音频轨 |
| `video_add_audio` | 添加/替换音轨 |
| `video_add_text` | 添加文字叠加层 |
| `video_add_watermark` | 添加图片水印 |
| `video_generate_gif` | 视频片段转 GIF |
| `video_gif_to_video` | GIF 转视频格式 |
| `video_create_thumbnail` | 生成视频缩略图 |
| `video_download_file` | 下载文件到本地 |
| `video_delete_file` | 删除远程文件 |

## 集成要点

### Docker Compose

```yaml
video-service:
  build:
    context: ./video-service
    dockerfile: Dockerfile
  container_name: game-studio-video-service
  ports:
    - "${VIDEO_SERVICE_PORT:-8084}:8084"
  environment:
    - VIDEO_SERVICE_PORT=8084
  volumes:
    - video-data:/app/data
  networks:
    - game-studio-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8084/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 15s
  restart: unless-stopped
```

Backend 环境变量：
```
VIDEO_SERVICE_URL=http://video-service:8084
```

### Dockerfile

```dockerfile
FROM alpine:3.21

RUN apk add --no-cache ffmpeg curl python3 py3-pip

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

COPY app/ ./app/

RUN mkdir -p /app/data

EXPOSE 8084

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8084"]
```

### 导出路径安全

视频处理工具生成的输出文件，导出到本地时路径限制在 `/app/output/{projectId}/games/latest/` 下，使用 `resolveSafePath` + `startsWith` 双重校验。

### 性能考量

- **超时设置**：大部分操作 300s；`concat`（长视频拼接）和 `compress`（veryslow preset）600s；`info` 30s
- **并发**：FFmpeg 本身支持多线程编码，容器单实例即可
- **内存**：建议分配 2GB+，大分辨率视频（4K+）可能更高
- **磁盘**：视频文件体积大，建议挂载 volume 留足空间

### 成本

- 镜像体积 ~120MB（Alpine + FFmpeg）
- 无需 GPU，纯 CPU 运算（FFmpeg 支持 VAAPI/QSV/NVENC 硬件加速可选，初版不启用）
- Altive 版不引入硬件加速依赖，降低复杂度

## 相关文件

| 文件 | 角色 |
|------|------|
| `video-service/Dockerfile` | 容器构建 |
| `video-service/requirements.txt` | Python 依赖 |
| `video-service/app/main.py` | FastAPI 入口 |
| `video-service/app/schemas.py` | Pydantic 模型 |
| `video-service/app/ffmpeg.py` | FFmpeg subprocess 执行器 |
| `video-service/app/operations.py` | FFmpeg CLI 参数生成器 |
| `video-service/app/safe_path.py` | 路径安全 |
| `video-service/app/routers/project.py` | 项目路由 |
| `video-service/app/routers/video.py` | 视频操作路由 |
| `video-service/app/routers/file.py` | 文件管理路由 |
| `server/video-service.ts` | TS HTTP 客户端 |
| `server/video-service.d.ts` | TS 类型定义 |
| `server/db.ts` | video_projects 表 + CRUD |
| `server/tools.ts` | 20 个 MCP 工具 |
| `server/agent-manager.ts` | ENGINEER_ALLOW 权限 |
| `server/agents.ts` | TOOLS_OVERVIEW + 系统提示词 |
| `docker-compose.yml` | video-service 容器 |
| `docker-compose.ui-test.yml` | ui-test 容器 |

## 测试策略

1. **单元测试**：`ffmpeg.py` 和 `operations.py` 独立测试
2. **集成测试**：docker-compose 中拉起 video-service 容器，curl 调用各端点
3. **UI Test**：通过 engineer agent 调用 video_* 工具，验证全链路

## 注意事项

- **ffprobe**：视频元信息使用 `ffprobe`（FFmpeg 自带，同包安装），非独立命令
- **concat**：拼接需要先生成文本文件列表（`filelist.txt`），每行 `file '/path/to/video.mp4'`
- **extract_audio**：无音频流的视频需返回明确错误信息
- **GIF 质量**：`generate_gif` 默认 10fps，建议分辨率和帧率给出合理默认值，防止文件过大
- **文字水印**：`add_text` 依赖系统字体，Alpine 中需安装 `font-noto` 或 `ttf-dejavu` 包
- **硬件加速**：初版不引入 VAAPI/QSV/NVENC 依赖；后续版本可按需添加 `h264_vaapi` 等编码器选项
