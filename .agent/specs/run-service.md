# 游戏运行微服务规范

> **SPEC-012** | 状态：设计中

## 目标

构建游戏运行微服务（`run-service`），为 game-studio 提供游戏的统一静态文件伺服和预览能力。架构复刻现有 creator service (Blender) 和 video service (FFmpeg) 模式：独立 FastAPI 容器 → HTTP → TS 客户端 → MCP 工具（仅 engineer 可用）。

核心流程：backend 上传游戏源码 → run-service 读取 `metadata.json` 判断 `game_type` → 验证产物完整性 → Nginx 统一通过 `/{project_id}/` 路径伺服各项目 `dist/` 目录。

> **重要约束**：run-service 仅支持基于**源码**运行（即上传包含源码和 `dist/` 目录的完整项目），不支持基于 build-service 构建产物的独立运行。测试服务（test-service）将直接通过 run-service 的静态伺服端点访问游戏。
>
> **当前阶段**：运行服务的使用场景暂不明确，本 spec 仅定义架构和 API，不涉及 `submit_game` 等现有工具的集成变更。

## 端口分离设计

| 端口 | 用途 | 说明 |
|------|------|------|
| **8086** | 管理 API | FastAPI REST API（项目管理、上传、文件操作） |
| **8087** | 静态文件伺服 | Nginx 统一伺服，通过 `/{project_id}/` 路由到各项目 `dist/` 目录 |

> **设计理由**：API 和静态文件伺服分离端口，避免路径冲突，便于独立扩缩容和安全策略配置。

## 游戏类型与伺服策略

Run service 通过读取项目根目录下的 `dist/metadata.json` 文件中的 `game_type` 字段判断伺服策略：

### 伺服策略映射

| game_type | 伺服方式 | 说明 |
|-----------|---------|------|
| `h5` | Nginx 静态文件 + SPA fallback | 托管 `dist/`，`try_files $uri $uri/ /index.html` |
| `phaser-mobile` | Nginx 静态文件 + SPA fallback | 等同 H5，额外暴露 `capacitor.config.json` |

> 所有游戏类型均使用同一 Nginx 实例伺服，通过 URL 路径前缀 `/{project_id}/` 区分项目。
> **扩展性**：未来新增游戏类型（如 Unity WebGL、Unreal Pixel Streaming）只需在 `GameRunner` 中注册新策略。

## 架构概述

```
run-service/ (FastAPI + Nginx, API:8086 + Static:8087)
├── app/main.py              # FastAPI entrypoint + /health
├── app/schemas.py           # Pydantic 请求/响应模型
├── app/strategies.py        # GameRunner：读取 metadata.json 验证伺服策略
├── app/safe_path.py         # 统一路径安全校验函数（resolve_safe_path）
├── app/routers/
│   ├── project.py           # 项目 CRUD + 源码上传
│   └── file.py              # 文件列表/下载/删除
├── requirements.txt
├── nginx.conf               # Nginx 配置（统一伺服，{project_id} 路由）
└── Dockerfile (alpine:3.21 + nginx, ~25MB)

server/
├── run-service.ts           # TS 客户端 (runFetch, createRunProject, uploadGame, ...)
├── run-service.d.ts         # TypeScript 类型定义
├── tools.ts                 # MCP 工具注册 (run_create_project, run_upload, run_delete_project, ...)
├── db.ts                    # SQLite run_projects 表
├── agent-manager.ts         # ENGINEER_ALLOW 权限
└── agents.ts                # 系统提示词 + TOOLS_OVERVIEW
```

### 与 Video / Build Service 的对照

| 维度 | Video Service (FFmpeg) | Build Service (Node.js) | Run Service (Nginx) |
|------|----------------------|------------------------|---------------------|
| 镜像 | alpine:3.21 + ffmpeg | alpine:3.21 + nodejs 22 | alpine:3.21 + nginx |
| 镜像大小 | ~120MB | ~180MB | ~25MB |
| 端口 | 8084 | 8085 | 8086（API）+ 8087（静态伺服） |
| 核心工具 | `ffmpeg` | `npm` / `npx` | `nginx` |
| 执行方式 | subprocess 一次性命令 | subprocess 长时间命令 | 容器启动时运行，持续伺服 |
| 项目存储 | `/app/data/projects/{id}` | 同 | 同 |
| 路由方式 | 各端点独立 | 各端点独立 | API 端点 + `/{project_id}/` 统一静态路由 |
| 策略层 | `operations.py` | `strategies.py` GameEngineBuilder | `strategies.py` GameRunner（仅验证） |

## 统一静态文件伺服

Nginx 监听 8087 端口，通过 `/{project_id}/` 路径前缀路由到对应项目的 `dist/` 目录：

```
用户访问:  http://run-service:8087/abc-123/
Nginx 映射: /app/data/projects/abc-123/dist/
```

每个项目的静态资源路径完全隔离，`project_id` 经过 `resolve_safe_path` 校验，防止路径穿越。

## API 设计

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{project_id}` | 创建项目目录（幂等） |
| GET | `/api/projects/{project_id}` | 查询项目状态与伺服信息 |
| DELETE | `/api/projects/{project_id}` | 删除项目目录及所有文件（幂等） |

### 源码上传

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{project_id}/upload` | 上传游戏源码项目（tar.gz），解压到项目目录。上传后自动可伺服 |

### 文件管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/{project_id}` | 列出项目文件（递归） |
| GET | `/api/files/{project_id}/{filename}` | 下载单文件 |
| DELETE | `/api/files/{project_id}/{filename}` | 删除文件（幂等） |
| DELETE | `/api/files/{project_id}` | 删除项目目录（幂等） |

### 静态文件伺服（Nginx，端口 8087）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/{project_id}/` | 伺服项目 `dist/index.html`（SPA fallback） |
| GET | `/{project_id}/{path}` | 伺服项目 `dist/` 下的任意静态资源 |

> **路径安全**：以上所有 API 端点中涉及 `project_id` 拼接、`filename` 路径操作时，必须通过 `_project_path()` + `_safe_join()` 校验（详见 [路径安全](#路径安全) 章节）。Nginx 静态路由同样通过 `rewrite` 规则限制在 `/app/data/projects/` 目录内。

### 通用响应格式

```json
// 上传成功
{
  "success": true,
  "game_type": "h5",
  "message": "Game uploaded and ready to serve",
  "preview_url": "http://run-service:8087/abc-123/",
  "file_count": 42
}

// 项目信息
{
  "project_id": "abc-123",
  "exists": true,
  "game_type": "h5",
  "preview_url": "http://run-service:8087/abc-123/",
  "file_count": 42
}

// 上传失败 (422)
{
  "detail": "metadata.json not found in uploaded package"
}
```

## 输入校验规则

| 字段 | 规则 |
|------|------|
| `project_id` | 正则 `/^[a-zA-Z0-9_-]{1,64}$/` |
| `game_type` | 从 metadata.json 读取，必须匹配已注册类型 (`h5`、`phaser-mobile`) |
| 上传文件大小 | 最大 200MB（游戏源码项目上限） |
| 上传文件格式 | `application/gzip`（tar.gz） |

## 伺服策略详解

### H5 游戏

```
1. 读取 metadata.json 确认 game_type == "h5"
2. 检查 dist/index.html 存在
3. dist/ 目录自动通过 Nginx 伺服，无需额外启动步骤
4. 返回 preview_url: http://run-service:8087/{project_id}/
```

### Phaser Mobile 游戏

```
1. 读取 metadata.json 确认 game_type == "phaser-mobile"
2. 检查 dist/index.html 存在
3. 检查 capacitor.config.json 是否存在
4. dist/ 目录自动通过 Nginx 伺服
5. 返回 preview_url + capacitor_config_available: true/false
```

## Nginx 配置

```nginx
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;

    # gzip 静态资源
    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;

    server {
        listen 8087;
        server_name localhost;

        # 统一静态文件伺服：/{project_id}/ → /app/data/projects/{project_id}/dist/
        location ~ ^/(?<project_id>[a-zA-Z0-9_-]{1,64})(/.*)?$ {
            # 安全检查：project_id 正则限制，防止路径穿越
            alias /app/data/projects/$project_id/dist/;

            index index.html;

            # SPA fallback
            try_files $uri $uri/ /index.html;

            # 允许跨域（开发调试需要）
            add_header Access-Control-Allow-Origin *;

            # 缓存策略：HTML 不缓存，静态资源短期缓存
            location ~ \.html$ {
                add_header Cache-Control "no-cache, must-revalidate";
            }
            location ~ \.(js|css|png|jpg|gif|svg|ico|woff2?)$ {
                expires 1h;
            }
        }
    }
}
```

> **安全要点**：`project_id` 通过 nginx `location` 正则 `[a-zA-Z0-9_-]{1,64}` 严格限制，与 API 层 `project_id` 校验规则一致，双重防护路径穿越。

## 数据模型

### `run_projects` 表（SQLite）

```sql
CREATE TABLE IF NOT EXISTS run_projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  game_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_projects_project ON run_projects(project_id);
```

> **简化说明**：移除 `run_status`、`port`、`nginx_pid`、`started_at`/`stopped_at` 字段。上传即伺服，无运行状态管理。结构与 `video_projects` / `image_projects` 完全一致。

## MCP 工具清单（6 个）

所有工具仅 **engineer** 可用，无需审批，`ENGINEER_ALLOW` 自动放行。

| 工具名 | 说明 |
|--------|------|
| `run_create_project` | 创建运行 project |
| `run_delete_project` | 删除运行 project 及所有文件 |
| `run_upload` | 上传游戏源码项目（解压并验证，上传后自动可伺服） |
| `run_status` | 查询项目伺服状态与预览地址 |
| `run_list_files` | 列出项目文件 |
| `run_delete_file` | 删除项目内文件 |

## 集成要点

### Docker Compose

```yaml
run-service:
  build:
    context: ./run-service
    dockerfile: Dockerfile
  container_name: game-studio-run-service
  ports:
    - "${RUN_SERVICE_API_PORT:-8086}:8086"
    - "${RUN_SERVICE_SERVE_PORT:-8087}:8087"
  environment:
    - RUN_SERVICE_API_PORT=8086
    - RUN_SERVICE_SERVE_PORT=8087
  volumes:
    - run-data:/app/data
  networks:
    - game-studio-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8086/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 10s
  restart: unless-stopped
```

新增 volume：`run-data`。

Backend 环境变量：
```
RUN_SERVICE_URL=http://run-service:8086
RUN_SERVICE_SERVE_URL=http://run-service:8087
```

### Dockerfile

```dockerfile
FROM alpine:3.21

# 安装 nginx + curl（healthcheck）+ python3（FastAPI）
RUN apk add --no-cache nginx curl python3 py3-pip

WORKDIR /app

# 创建数据目录
RUN mkdir -p /app/data/projects /run/nginx
RUN chown -R nginx:nginx /app/data

# Nginx 配置
COPY nginx.conf /etc/nginx/nginx.conf

# Python FastAPI 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

COPY app/ ./app/

EXPOSE 8086 8087

# 启动脚本：后台 nginx + 前台 uvicorn
COPY entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
```

**entrypoint.sh：**

```bash
#!/bin/sh
set -e

# 启动 Nginx（后台）
nginx -g "daemon off;" &

# 启动 FastAPI（前台，作为容器主进程）
exec uvicorn app.main:app --host 0.0.0.0 --port 8086
```

> **镜像大小估算**：Alpine (~7MB) + nginx (~5MB) + Python/FastAPI (~10MB) ≈ **~25MB**。
> **为什么不动态管理 Nginx**：统一 Nginx 实例伺服所有项目，通过 URL 路径 `/{project_id}/` 路由，无需 per-project 进程管理，架构更简单。

### 端口分配总览

| 服务 | 端口 | 状态 |
|------|------|------|
| creator (Blender) | 8080 | 已实现 |
| scanner (Sonar) | 8081 | 已实现 |
| drawio-service | 8082 | 已实现 |
| drawio-export | 8083 | 已实现 |
| image-service (ImageMagick) | 待定 | 设计中 |
| video-service (FFmpeg) | 8084 | 设计中 |
| build-service (Node.js) | 8085 | 设计中 |
| **run-service API** | **8086** | 设计中 |
| **run-service 静态伺服** | **8087** | 设计中 |

## 路径安全

> **所有涉及文件路径操作的代码，必须在服务内部（Python）、Nginx 配置和 TS 客户端三侧统一使用安全校验函数，禁止自行拼接路径。**

### 三层安全

| 层级 | 位置 | 函数/规则 | 职责 |
|------|------|------|------|
| **微服务内部** | `run-service/app/safe_path.py` | `resolve_safe_path(base, user_path)` | 所有 FastAPI 路由中涉及 `project_id`、`filename` 拼接时统一调用 |
| **Nginx 配置** | `run-service/nginx.conf` | `location ~ ^/(?<project_id>[a-zA-Z0-9_-]{1,64})` | `project_id` 正则严格限制，防止路径穿越 |
| **TS 客户端** | `server/db.ts` (已有) | `resolveSafePath(baseDir, fileName)` | 下载/删除文件时校验本地输出路径 |

### 路由层使用规范

```python
from app.safe_path import resolve_safe_path

PROJECTS_ROOT = "/app/data/projects"

def _project_path(project_id: str) -> str:
    try:
        return resolve_safe_path(PROJECTS_ROOT, project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

def _safe_join(base: str, filename: str) -> str:
    try:
        return resolve_safe_path(base, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

### 路由覆盖范围

| 路由文件 | 涉及路径操作 | 安全函数使用 |
|---------|-------------|-------------|
| `routers/project.py` | 上传、创建、删除时解析 `project_id` | `_project_path()` |
| `routers/file.py` | 列出/下载/删除文件 | `_project_path()` + `_safe_join()` |

**硬性要求**：
- 任何路由中访问项目目录、读写文件前，**必须先调用 `_project_path()`** 校验 `project_id`
- 禁止在路由中直接使用 `os.path.join(PROJECTS_ROOT, project_id)` 或字符串拼接路径
- 上传 tar.gz 解压时必须在 `_project_path()` 返回的目录内操作
- Nginx `location` 正则必须与 API 层 `project_id` 校验规则一致

## 运行安全

### Nginx 配置安全

- **路径限制**：`location` 正则 `[a-zA-Z0-9_-]{1,64}` 严格限制 `project_id` 字符集
- **alias 隔离**：每个项目通过 `alias /app/data/projects/$project_id/dist/` 独立映射
- **双层防护**：即便 Nginx 正则被绕过，Python API 层的 `resolve_safe_path` 也会阻止非法路径写入

### 上传安全

- 上传 tar.gz 前校验 Content-Type 为 `application/gzip`
- 解压前检查文件大小不超过 200MB
- 解压到临时目录，验证 `dist/metadata.json` 存在后再移动到项目目录
- 旧项目目录在上传新包前先清空

### 容器端口暴露

- 开发环境：映射 8086 + 8087 到宿主机
- 生产环境：仅映射 8087（静态伺服），或通过反向代理统一暴露

## 性能考量

- **并发项目**：无上限，受磁盘空间和 Nginx worker_connections 限制（默认 1024）
- **内存**：Nginx ~10MB + Python FastAPI ~100MB = **~110MB 稳定占用**，不随项目数增长
- **磁盘**：挂载 volume 2GB+，每个游戏 dist 约 5-50MB
- **静态资源缓存**：Nginx `expires 1h` + gzip 压缩

## 成本

- 镜像体积 ~25MB（Alpine + nginx + Python/FastAPI）
- 纯 CPU 运算，无需 GPU
- 内存占用固定 ~110MB，不随项目数增长

## 使用场景（TBD）

运行服务暂不集成到现有 workflow。后续可能的使用场景：

1. **游戏预览**：engineer 构建完成后即时预览效果
2. **测试验证**：CI 中自动启动游戏实例执行 E2E 测试
3. **分享演示**：生成临时预览链接供团队成员查看
4. **多版本对比**：同时运行多个版本进行 A/B 对比

## 相关文件

| 文件 | 角色 |
|------|------|
| `run-service/Dockerfile` | 容器构建 |
| `run-service/entrypoint.sh` | 容器启动脚本（nginx + uvicorn） |
| `run-service/nginx.conf` | Nginx 配置（统一伺服，端口 8087） |
| `run-service/requirements.txt` | Python 依赖 |
| `run-service/app/main.py` | FastAPI 入口（端口 8086） |
| `run-service/app/schemas.py` | Pydantic 模型 |
| `run-service/app/strategies.py` | GameRunner：metadata.json 解析 + 策略验证 |
| `run-service/app/safe_path.py` | 路径安全 |
| `run-service/app/routers/project.py` | 项目路由 + 源码上传 |
| `run-service/app/routers/file.py` | 文件管理路由 |
| `server/run-service.ts` | TS HTTP 客户端 |
| `server/run-service.d.ts` | TS 类型定义 |
| `server/db.ts` | run_projects 表 + CRUD |
| `server/tools.ts` | 6 个 MCP 工具 |
| `server/agent-manager.ts` | ENGINEER_ALLOW 权限 |
| `server/agents.ts` | TOOLS_OVERVIEW + 系统提示词 |
| `docker-compose.yml` | run-service 容器 |

## 测试策略

1. **单元测试**：`strategies.py` GameRunner 策略验证
2. **集成测试**：docker-compose 拉起 run-service，curl 上传 mock 游戏源码项目 → 访问 preview_url 验证静态伺服 → delete 项目
3. **UI Test**：通过 engineer agent 调用 `run_*` 工具，验证全链路

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动更新所有相关文档规范

实现新功能后，必须主动检查并更新所有受影响的文档：
1. `README.md` + `README.zh-CN.md`
2. `docs/ARCHITECTURE.md` + `docs/ARCHITECTURE.zh-CN.md`
3. `.agent/memory/ARCHITECTURE.md`
4. `.agent/memory/INDEX.md`
5. `.agent/memory/MEMORY.md`
6. `.agent/specs/INDEX.md`
7. 不相关的文档不需要修改

## 详细 Debug 日志规范

1. **后端 API 路由**：`console.log('[DEBUG:run-service] stepN: ...')`
2. **E2E 测试**：`process.stderr.write('[UI-XXX] step: ...')`

## 注意事项

- **上传即伺服**：游戏包上传成功后立即通过 Nginx 可访问，无需额外的启动/停止步骤
- **目录覆盖**：上传新游戏包前清空旧项目目录，避免残留文件
- **metadata.json 未找到**：上传后校验，缺失时返回错误
- **dist/index.html 未找到**：返回错误，提示缺少入口文件
- **Nginx alias 与 trailing slash**：`alias` 指令的路径末尾 `/` 必须与 `location` 的 `/` 对齐，否则 `try_files` 行为异常
- **文件目录删除**：所有项目目录和文件支持通过 API 删除，DELETE 方法幂等
- **容器重启**：restart 后 `run-data` volume 中的项目数据依然存在，Nginx 自动恢复伺服
- **无进程管理**：不需要 `port_manager.py`、`runner.py`、nginx 子进程管理，架构更简洁
