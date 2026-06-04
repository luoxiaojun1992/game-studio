# 游戏运行微服务规范

> **SPEC-012** | 状态：设计中

## 目标

构建游戏运行微服务（`run-service`），为 game-studio 提供已打包游戏在隔离环境中的运行和预览能力。架构复刻现有 creator service (Blender) 和 video service (FFmpeg) 模式：独立 FastAPI 容器 → HTTP → TS 客户端 → MCP 工具（仅 engineer 可用）。

核心流程：backend 上传已打包的游戏产物 → run-service 读取 `metadata.json` 判断 `game_type` → 选择运行策略 → 启动运行环境 → 返回预览地址。

> **当前阶段**：运行服务的使用场景暂不明确，本 spec 仅定义架构和 API，不涉及 `submit_game` 等现有工具的集成变更。

## 游戏类型与运行策略

Run service 通过读取项目根目录下的 `dist/metadata.json` 文件中的 `game_type` 字段判断运行策略：

### 运行策略映射

| game_type | 运行方式 | 端口分配 | 说明 |
|-----------|---------|---------|------|
| `h5` | Nginx 静态文件服务 | 动态分配（9000-9099） | 托管 `dist/` 目录，启动 nginx worker |
| `phaser-mobile` | Nginx 静态文件服务 + Capacitor 配置提示 | 动态分配（9000-9099） | 托管 `dist/` 目录，额外暴露 capacitor.config.json 供移动端参考 |

> **扩展性**：未来新增游戏类型（如 Unity WebGL、Unreal Pixel Streaming）只需在 `GameRunner` 中注册新策略。

### 运行状态

| 状态 | 说明 |
|------|------|
| `stopped` | 初始状态，未运行 |
| `starting` | 正在启动 nginx / 运行环境 |
| `running` | 正常运行中，可访问 |
| `stopping` | 正在停止 |
| `error` | 启动失败（端口占用、文件缺失等） |

## 架构概述

```
run-service/ (FastAPI + Nginx, port 8086)
├── app/main.py              # FastAPI entrypoint + /health
├── app/schemas.py           # Pydantic 请求/响应模型
├── app/runner.py            # subprocess 执行器（nginx 启动/停止）
├── app/strategies.py        # GameRunner：读取 metadata.json 分发运行策略
├── app/port_manager.py      # 端口分配器（9000-9099 范围管理）
├── app/safe_path.py         # 统一路径安全校验函数（resolve_safe_path）
├── app/routers/
│   ├── project.py           # 项目 CRUD + 游戏包上传
│   ├── run.py               # 运行/停止端点
│   └── file.py              # 文件列表/下载/删除
├── requirements.txt
├── nginx.conf.template      # Nginx 配置模板（端口动态替换）
└── Dockerfile (alpine:3.21 + nginx, ~120MB)

server/
├── run-service.ts           # TS 客户端 (runFetch, createRunProject, startRun, stopRun, ...)
├── run-service.d.ts         # TypeScript 类型定义
├── tools.ts                 # MCP 工具注册 (run_upload, run_start, run_stop, run_status, ...)
├── db.ts                    # SQLite run_projects 表
├── agent-manager.ts         # ENGINEER_ALLOW 权限
└── agents.ts                # 系统提示词 + TOOLS_OVERVIEW
```

### 与 Video / Build Service 的对照

| 维度 | Video Service (FFmpeg) | Build Service (Node.js) | Run Service (Nginx) |
|------|----------------------|------------------------|---------------------|
| 镜像 | alpine:3.21 + ffmpeg | alpine:3.21 + nodejs 22 | alpine:3.21 + nginx |
| 镜像大小 | ~120MB | ~180MB | ~15MB |
| 端口 | 8084 | 8085 | 8086（管理）+ 9000-9099（游戏实例） |
| 核心工具 | `ffmpeg` | `npm` / `npx` | `nginx` |
| 执行方式 | subprocess 一次性命令 | subprocess 长时间命令 | subprocess 后台进程管理 |
| 项目存储 | `/app/data/projects/{id}` | 同 | 同 |
| 超时 | 300s | 600s | 无（持续运行，手动停止） |
| 策略层 | `operations.py` | `strategies.py` GameEngineBuilder | `strategies.py` GameRunner |

## API 设计

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{project_id}` | 创建项目目录（幂等） |
| GET | `/api/projects/{project_id}` | 查询项目状态与运行信息 |
| DELETE | `/api/projects/{project_id}` | 删除项目目录（先 stop 再删除，幂等） |

### 游戏包上传

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{project_id}/upload` | 上传已打包的游戏产物（tar.gz），解压到项目目录 |

### 运行控制

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/run/{project_id}/start` | 启动游戏运行环境（分配端口 + 生成 nginx config + 启动 nginx） |
| POST | `/api/run/{project_id}/stop` | 停止游戏运行环境（停止 nginx + 释放端口，幂等） |
| GET | `/api/run/{project_id}/status` | 查询运行状态与预览地址 |

### 文件管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/{project_id}` | 列出项目文件（递归） |
| GET | `/api/files/{project_id}/{filename}` | 下载单文件 |
| DELETE | `/api/files/{project_id}/{filename}` | 删除文件（幂等） |
| DELETE | `/api/files/{project_id}` | 删除项目目录内所有文件 |

> **路径安全**：以上所有端点中涉及 `project_id` 拼接、`filename` 路径操作时，必须通过 `_project_path()` + `_safe_join()` 校验（详见 [路径安全](#路径安全) 章节）。

### 通用响应格式

```json
// 启动成功
{
  "success": true,
  "game_type": "h5",
  "status": "running",
  "port": 9001,
  "preview_url": "http://run-service:9001",
  "message": "Game started successfully on port 9001"
}

// 停止成功
{
  "success": true,
  "message": "Game stopped, port 9001 released"
}

// 运行状态
{
  "project_id": "abc-123",
  "game_type": "h5",
  "status": "running",
  "port": 9001,
  "preview_url": "http://run-service:9001",
  "started_at": "2026-06-04T08:20:00Z"
}

// 启动失败 (422)
{
  "detail": "No available ports in range 9000-9099"
}

// 项目信息
{
  "project_id": "abc-123",
  "exists": true,
  "game_type": "h5",
  "run_status": "stopped",
  "port": null
}
```

## 输入校验规则

| 字段 | 规则 |
|------|------|
| `project_id` | 正则 `/^[a-zA-Z0-9_-]{1,64}$/` |
| `game_type` | 从 metadata.json 读取，必须匹配已注册类型 (`h5`、`phaser-mobile`) |
| 上传文件大小 | 最大 200MB（已打包游戏产物上限） |
| 上传文件格式 | `application/gzip`（tar.gz） |
| `port` | 9000-9099，由服务自动分配 |

## 运行策略详解

### H5 游戏

```
1. 读取 metadata.json 确认 game_type == "h5"
2. 检查 dist/index.html 存在
3. 分配可用端口（9000-9099）
4. 从 nginx.conf.template 生成实例配置：
   - server_name: localhost
   - listen: {port}
   - root: /app/data/projects/{project_id}/dist
   - index: index.html
   - SPA fallback: try_files $uri $uri/ /index.html
5. 写入临时配置 /app/nginx_conf/{project_id}.conf
6. nginx -c /app/nginx_conf/{project_id}.conf（独立进程）
7. 返回 preview_url
```

**nginx.conf.template：**

```nginx
worker_processes 1;
error_log /app/data/projects/{PROJECT_ID}/nginx_error.log;
pid /app/data/projects/{PROJECT_ID}/nginx.pid;

events {
    worker_connections 256;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;

    server {
        listen {PORT};
        server_name localhost;

        root /app/data/projects/{PROJECT_ID}/dist;
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }

        # 允许跨域（开发调试需要）
        add_header Access-Control-Allow-Origin *;
    }
}
```

### Phaser Mobile 游戏

```
1. 读取 metadata.json 确认 game_type == "phaser-mobile"
2. 检查 dist/index.html 存在
3. 分配可用端口（9000-9099）
4. 生成 nginx 配置（同 H5）
5. 额外检查 capacitor.config.json 是否存在
6. 启动 nginx
7. 返回 preview_url + capacitor_config_available: true/false
```

## 端口管理

`port_manager.py` 负责 9000-9099 范围的端口分配与回收：

```python
class PortManager:
    """端口分配器，线程安全"""
    
    def __init__(self, start: int = 9000, end: int = 9099):
        self._range = range(start, end + 1)
        self._used: dict[str, int] = {}  # project_id -> port
    
    def allocate(self, project_id: str) -> int:
        """分配一个未使用端口，已分配的项目返回已有端口"""
        if project_id in self._used:
            return self._used[project_id]
        for port in self._range:
            if port not in self._used.values():
                self._used[project_id] = port
                return port
        raise NoAvailablePortError()
    
    def release(self, project_id: str) -> None:
        """释放项目占用的端口"""
        self._used.pop(project_id, None)
```

- 端口分配前通过 `socket.bind()` 探测端口是否真正可用
- 同一 project_id 重复 start 为幂等操作，返回已有端口
- stop 时释放端口

## 数据模型

### `run_projects` 表（SQLite）

```sql
CREATE TABLE IF NOT EXISTS run_projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  game_type TEXT,
  run_status TEXT NOT NULL DEFAULT 'stopped',
  port INTEGER,
  nginx_pid INTEGER,
  started_at TEXT,
  stopped_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_projects_project ON run_projects(project_id);
```

`run_status` 枚举：`"stopped"` | `"starting"` | `"running"` | `"stopping"` | `"error"`

结构与 `build_projects` 类似，增加 `port`、`nginx_pid`、运行时间字段。

## MCP 工具清单（8 个）

所有工具仅 **engineer** 可用，无需审批，`ENGINEER_ALLOW` 自动放行。

| 工具名 | 说明 |
|--------|------|
| `run_create_project` | 创建运行 project |
| `run_delete_project` | 删除运行 project（先 stop） |
| `run_upload` | 上传已打包游戏产物到运行服务 |
| `run_start` | 启动游戏运行环境（自动识别 game_type） |
| `run_stop` | 停止游戏运行环境 |
| `run_status` | 查询运行状态与预览地址 |
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
    - "${RUN_SERVICE_PORT:-8086}:8086"
    - "9000-9099:9000-9099"
  environment:
    - RUN_SERVICE_PORT=8086
    - NGINX_PORT_RANGE_START=9000
    - NGINX_PORT_RANGE_END=9099
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

> **端口映射**：管理 API 端口 8086 + 游戏运行端口范围 9000-9099。生产环境建议通过反向代理统一暴露，不使用大范围端口映射。

新增 volume：`run-data`。

Backend 环境变量：
```
RUN_SERVICE_URL=http://run-service:8086
```

### Dockerfile

```dockerfile
FROM alpine:3.21

# 安装 nginx + curl（healthcheck）+ python3（FastAPI）
RUN apk add --no-cache nginx curl python3 py3-pip

WORKDIR /app

# Nginx 配置模板
COPY nginx.conf.template /app/
RUN mkdir -p /app/nginx_conf /app/data /app/data/projects

# Python FastAPI 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

COPY app/ ./app/

EXPOSE 8086
EXPOSE 9000-9099

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8086"]
```

> **镜像大小估算**：Alpine (~7MB) + nginx (~5MB) + Python/FastAPI (~10MB) ≈ **~22MB**。

> **为什么不用 Node.js serve**：Nginx 成熟稳定，支持 SPA fallback、MIME types、静态文件缓存，配置模板化便于动态生成。Node.js 静态服务方案（如 serve 包）作为备选。

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
| **run-service (Nginx)** | **8086（管理）+ 9000-9099（游戏）** | 设计中 |

## 路径安全

> **所有涉及文件路径操作的代码，必须在服务内部（Python）和 TS 客户端两侧统一使用安全校验函数，禁止自行拼接路径。**

### 总体架构

| 层级 | 位置 | 函数 | 职责 |
|------|------|------|------|
| **微服务内部** | `run-service/app/safe_path.py` | `resolve_safe_path(base, user_path)` | 所有 FastAPI 路由中涉及 `project_id`、`filename` 拼接时统一调用 |
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
| `routers/run.py` | 启动时读取 metadata.json、生成 nginx config | `_project_path()` + `_safe_join()` |
| `routers/file.py` | 列出/下载/删除文件 | `_project_path()` + `_safe_join()` |

**硬性要求**：
- Nginx 配置写入必须在 `_safe_join()` 校验后的路径内
- Nginx `root` 指令必须指向 `_project_path()` 返回的 dist 目录

## 运行安全

### Nginx 进程管理

- 每个游戏实例运行独立 nginx master + worker 进程
- 使用 `nginx -c {config_path}` 指定独立配置文件，避免与系统 nginx 冲突
- 启动时记录 PID 到 `run_projects` 表，停止时通过 PID kill
- 停止策略：先 `nginx -s quit`（graceful shutdown，5s 超时），超时后 `kill -TERM`，再超时 `kill -KILL`
- 异常退出：定期检查 PID 是否存在，不存在则自动标记为 `error` 状态

### subprocess 执行安全

- 所有 nginx 操作通过 `subprocess.run()` 执行
- 禁止使用 `shell=True`
- nginx 配置文件在写入前做模板变量注入校验（`PROJECT_ID`、`PORT` 均来自已验证的输入）

### 容器端口暴露

- 开发环境：映射 9000-9099 到宿主机
- 生产环境：不映射游戏端口，仅通过 backend 反向代理访问（后续 phase）

## 性能考量

- **并发游戏实例**：最多 100 个（9000-9099 共 100 端口），每个实例 ~5MB 内存（nginx worker）
- **内存**：100 个实例约 500MB + Python FastAPI ~100MB = **~600MB 建议分配**
- **磁盘**：挂载 volume 2GB+，每个游戏 dist 约 5-50MB
- **启动时间**：nginx 启动 < 1s

## 成本

- 镜像体积 ~22MB（Alpine + nginx + Python/FastAPI）
- 纯 CPU 运算，无需 GPU
- 内存占用与运行实例数线性相关

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
| `run-service/nginx.conf.template` | Nginx 配置模板 |
| `run-service/requirements.txt` | Python 依赖 |
| `run-service/app/main.py` | FastAPI 入口 |
| `run-service/app/schemas.py` | Pydantic 模型 |
| `run-service/app/runner.py` | Nginx subprocess 管理 |
| `run-service/app/strategies.py` | GameRunner：metadata.json 解析 + 策略分发 |
| `run-service/app/port_manager.py` | 端口分配管理器 |
| `run-service/app/safe_path.py` | 路径安全 |
| `run-service/app/routers/project.py` | 项目路由 + 游戏包上传 |
| `run-service/app/routers/run.py` | 运行/停止路由 |
| `run-service/app/routers/file.py` | 文件管理路由 |
| `server/run-service.ts` | TS HTTP 客户端 |
| `server/run-service.d.ts` | TS 类型定义 |
| `server/db.ts` | run_projects 表 + CRUD |
| `server/tools.ts` | 8 个 MCP 工具 |
| `server/agent-manager.ts` | ENGINEER_ALLOW 权限 |
| `server/agents.ts` | TOOLS_OVERVIEW + 系统提示词 |
| `docker-compose.yml` | run-service 容器 |

## 测试策略

1. **单元测试**：`strategies.py` GameRunner 策略分发、`port_manager.py` 端口分配逻辑
2. **集成测试**：docker-compose 拉起 run-service，curl 上传 mock 游戏包 → start → 访问 preview_url → stop
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

- **Nginx 配置隔离**：每个游戏实例使用独立配置文件，互不干扰
- **端口回收**：stop 时确保端口释放，nginx 进程完全终止
- **Graceful shutdown**：优先 `nginx -s quit`，超时后 force kill
- **metadata.json 未找到**：启动前检查，缺失时返回错误
- **dist/index.html 未找到**：返回错误，提示缺少入口文件
- **Docker 端口映射**：开发环境映射 9000-9099，生产环境建议 Nginx 反向代理
- **文件目录删除**：所有项目目录和文件支持通过 API 删除，DELETE 方法幂等，stop 后才能删除运行中的项目
- **容器重启恢复**：container restart 后所有运行状态重置为 `stopped`，port_manager 重新初始化
