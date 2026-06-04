# 游戏打包微服务规范

> **SPEC-011** | 状态：设计中

## 目标

构建游戏打包微服务（`build-service`），为 game-studio 提供游戏源码自动化构建能力。架构复刻现有 creator service (Blender) 和 video service (FFmpeg) 模式：独立 FastAPI 容器 → HTTP → TS 客户端 → MCP 工具（仅 engineer 可用）。

核心流程：backend 上传游戏源码 → build-service 读取 `metadata.json` 判断 `game_type` → 选择打包策略 → 执行构建 → backend 下载构建产物替换 `games/latest` 目录 → 与源码一起 ZIP 上传 MinIO。

## 游戏类型与打包策略

Build service 通过读取项目根目录下的 `dist/metadata.json` 文件中的 `game_type` 字段判断游戏类型：

### metadata.json 结构

```json
{
  "title": "Game Title",
  "version": "1.0.0",
  "game_type": "h5",
  "resolution": { "width": 800, "height": 600 },
  "orientation": "landscape",
  "entry": "index.html"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `game_type` | string | 游戏类型，当前支持 `"h5"`、`"phaser-mobile"` |

### 打包策略映射

| game_type | 构建命令 | 产物目录 | 说明 |
|-----------|---------|---------|------|
| `h5` | `npm install && npm run build` | `dist/` | PixiJS + Matter.js + Vite，H5 浏览器游戏 |
| `phaser-mobile` | `npm install && npm run build && npx cap sync` | `dist/` | Phaser 3 + Capacitor + Vite，移动端游戏，cap sync 生成原生项目配置 |

> **扩展性**：未来新增游戏类型只需在 `GameEngineBuilder` 中注册新策略，无需修改路由和通用逻辑。

### 构建失败处理

- `npm install` 失败：返回 stderr，标注依赖安装错误
- `npm run build` 失败：返回 stderr，标注编译错误
- `cap sync` 失败：warning 级别，不阻断整体构建（`dist/` 产物仍然可用）
- **超时**：构建超时 600s，超时后 kill 进程树并返回超时错误

## 架构概述

```
build-service/ (FastAPI + Node.js 22, port 8085)
├── app/main.py              # FastAPI entrypoint + /health
├── app/schemas.py           # Pydantic 请求/响应模型
├── app/builder.py           # subprocess 执行器（npm/vite/capacitor）
├── app/strategies.py        # GameEngineBuilder：读取 metadata.json 分发构建策略
├── app/safe_path.py         # 统一路径安全校验函数（resolve_safe_path）
├── app/routers/
│   ├── project.py           # 项目 CRUD + 源码上传
│   ├── build.py             # 构建触发端点
│   └── file.py              # 文件列表/下载/删除
├── requirements.txt
└── Dockerfile (alpine:3.21 + nodejs 22 + npm, ~180MB)

server/
├── build-service.ts         # TS 客户端 (buildFetch, createBuildProject, uploadSource, triggerBuild, ...)
├── build-service.d.ts       # TypeScript 类型定义
├── tools.ts                 # MCP 工具注册 (build_upload_source, build_trigger, build_download, ...)
├── db.ts                    # SQLite build_projects 表
├── agent-manager.ts         # ENGINEER_ALLOW 权限
└── agents.ts                # 系统提示词 + TOOLS_OVERVIEW
```

### 与 Video / Image Service 的对照

| 维度 | Video Service (FFmpeg) | Image Service (ImageMagick) | Build Service (Node.js) |
|------|----------------------|---------------------------|------------------------|
| 镜像 | alpine:3.21 + ffmpeg | alpine:3.21 + imagemagick | alpine:3.21 + nodejs 22 + npm |
| 镜像大小 | ~120MB | ~50MB | ~180MB |
| 端口 | 8084 | 8083 | 8085 |
| 核心工具 | `ffmpeg` / `ffprobe` | `magick` | `npm` / `npx`（全局 capacitor CLI） |
| 执行方式 | `ffmpeg -i input <args> output` | `magick <args>` | `npm install && npm run build` |
| 项目存储 | `/app/data/projects/{id}` | 同 | 同 |
| 超时 | 300s | 60s | 600s（npm install + build 耗时较长） |
| 策略层 | `operations.py` 生成 CLI 参数 | 同 | `strategies.py` GameEngineBuilder 分发 |

## API 设计

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{project_id}` | 创建项目目录（幂等） |
| GET | `/api/projects/{project_id}` | 查询项目状态与构建信息 |
| DELETE | `/api/projects/{project_id}` | 删除项目目录及所有文件（幂等） |

### 源码上传

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{project_id}/upload` | 上传游戏源码（tar.gz 二进制流），解压到项目目录 |

### 构建

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/build/{project_id}` | 触发构建。读取 metadata.json → 选择策略 → 执行 → 返回结果 |

### 文件管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/{project_id}` | 列出项目文件（递归） |
| GET | `/api/files/{project_id}/download` | 下载整个项目目录为 tar.gz |
| GET | `/api/files/{project_id}/{filename}` | 下载单文件 |
| DELETE | `/api/files/{project_id}/{filename}` | 删除文件（幂等） |
| DELETE | `/api/files/{project_id}` | 删除项目目录内所有文件 |

> **路径安全**：以上所有端点中涉及 `project_id` 拼接、`filename` 路径操作时，必须通过 `_project_path()` + `_safe_join()` 校验（详见 [路径安全](#路径安全) 章节）。

### 通用响应格式

```json
// 构建成功
{
  "success": true,
  "build_log": "npm install 和 build 的合并 stdout 日志",
  "game_type": "h5",
  "strategy": "h5",
  "output_dir": "dist",
  "message": "Build completed: h5 game packaged successfully",
  "files": ["index.html", "assets/index.js", "assets/style.css"]
}

// 构建失败 (422)
{
  "detail": "Build error: npm install failed\nSTDERR: ..."
}

// 项目信息
{
  "project_id": "abc-123",
  "exists": true,
  "game_type": "h5",
  "build_status": "completed",
  "file_count": 42
}

// 上传成功
{
  "success": true,
  "message": "Source uploaded and extracted to project abc-123",
  "file_count": 15
}
```

## 输入校验规则

| 字段 | 规则 |
|------|------|
| `project_id` | 正则 `/^[a-zA-Z0-9_-]{1,64}$/` |
| `game_type` | 从 metadata.json 读取，必须匹配已注册类型 (`h5`、`phaser-mobile`) 或 `"unknown"` |
| 上传文件大小 | 最大 200MB（游戏源码 + assets 上限） |
| 上传文件格式 | `application/gzip` 或 `application/octet-stream`（tar.gz） |

## 构建命令映射

| game_type | 命令序列 |
|-----------|---------|
| `h5` | ① `cd /app/data/projects/{project_id}` ② `npm install --prefer-offline` ③ `npm run build` |
| `phaser-mobile` | ① `cd /app/data/projects/{project_id}` ② `npm install --prefer-offline` ③ `npm run build` ④ `npx cap sync` |

> `--prefer-offline`：优先使用 npm 缓存，减少网络依赖。Docker 构建时预装常用包（vite、phaser、pixi.js、matter-js、@capacitor/core、@capacitor/cli）到全局缓存 `/root/.npm`。

## 数据模型

### `build_projects` 表（SQLite）

```sql
CREATE TABLE IF NOT EXISTS build_projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  build_project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  game_type TEXT,
  build_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_build_projects_project ON build_projects(project_id);
```

`build_status` 枚举：`"pending"` | `"building"` | `"completed"` | `"failed"`

结构与 `video_projects` / `image_projects` 完全一致，增加 `game_type` 和 `build_status` 字段。

## MCP 工具清单（8 个）

所有工具仅 **engineer** 可用，无需审批，`ENGINEER_ALLOW` 自动放行。

| 工具名 | 说明 |
|--------|------|
| `build_create_project` | 创建打包 project |
| `build_delete_project` | 删除打包 project 及所有文件 |
| `build_upload_source` | 上传游戏源码到打包服务 |
| `build_trigger` | 触发构建（自动识别 game_type） |
| `build_get_status` | 查询构建状态 |
| `build_list_files` | 列出项目文件 |
| `build_download` | 下载构建产物为 tar.gz |
| `build_delete_file` | 删除项目内文件 |

## 集成要点

### submit_game 流程变更

当前 `submit_game` 直接打包 `games/latest` 目录上传 MinIO。变更后流程：

```
1. submit_game 工具触发
2. 读取 output/{projectId}/games/latest/ 源码
3. 将源码打包为 tar.gz
4. 调用 build_upload_source 上传到 build-service
5. 调用 build_trigger 触发构建
6. 轮询 build_get_status 直到 completed/failed
7. 调用 build_download 下载构建产物 (tar.gz)
8. 解压构建产物到本地临时目录
9. 用构建产物替换 games/latest/dist/ 目录
10. 继续原有流程：ZIP games/latest → Lint → Sonar → MinIO 上传
```

关键代码变更位置 `server/tools.ts` 中的 `submit_game` 工具：

```typescript
// 新增：调用 build-service 进行构建
import { createBuildProject, uploadSource, triggerBuild, downloadBuild } from './build-service.js';

// 在 submit_game 工具 handler 中，目录验证之后、ZIP 打包之前插入：
const buildProjectId = await createBuildProject({ projectId });
const sourceTarGz = await createTarGz(sourceDir);
await uploadSource({ buildProjectId, tarGz: sourceTarGz });
const buildResult = await triggerBuild({ buildProjectId });
if (!buildResult.success) {
  return { content: [{ type: 'text', text: `构建失败: ${buildResult.detail}` }] };
}
const buildOutput = await downloadBuild({ buildProjectId });
await extractTarGz(buildOutput, sourceDir + '/dist');
```

### Docker Compose

```yaml
build-service:
  build:
    context: ./build-service
    dockerfile: Dockerfile
  container_name: game-studio-build-service
  ports:
    - "${BUILD_SERVICE_PORT:-8085}:8085"
  environment:
    - BUILD_SERVICE_PORT=8085
    - NPM_CACHE=/root/.npm
  volumes:
    - build-data:/app/data
    - npm-cache:/root/.npm
  networks:
    - game-studio-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8085/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 20s
  restart: unless-stopped
```

新增 volume：`npm-cache`（持久化 npm 缓存，加速重复构建）。

Backend 环境变量：
```
BUILD_SERVICE_URL=http://build-service:8085
```

### Dockerfile

```dockerfile
FROM alpine:3.21

# 安装 Node.js 22 + npm + curl（healthcheck）+ python3（FastAPI）
RUN apk add --no-cache nodejs=22~ npm curl python3 py3-pip

# 全局安装 capacitor CLI（phaser-mobile 构建需要）
RUN npm install -g @capacitor/cli @capacitor/core

# 预装常用游戏引擎到 npm 全局缓存，加速构建
RUN npm install -g vite phaser pixi.js matter-js

WORKDIR /app

# Python FastAPI 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

# 创建数据目录
RUN mkdir -p /app/data /app/data/projects

COPY app/ ./app/

# 配置 npm 缓存目录
ENV NPM_CACHE=/root/.npm
ENV npm_config_cache=/root/.npm

EXPOSE 8085

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8085"]
```

> **镜像大小估算**：Alpine (~7MB) + Node.js 22 (~80MB) + npm (~30MB) + 预装包 (~50MB) + Python/FastAPI (~15MB) ≈ **~180MB**。

### 端口分配总览

| 服务 | 端口 | 状态 |
|------|------|------|
| creator (Blender) | 8080 | 已实现 |
| scanner (Sonar) | 8081 | 已实现 |
| drawio-service | 8082 | 已实现 |
| drawio-export | 8083 | 已实现 |
| image-service (ImageMagick) | ~~8083~~ → 待定 | 设计中（与 drawio-export 端口冲突） |
| video-service (FFmpeg) | 8084 | 设计中 |
| **build-service (Node.js)** | **8085** | 设计中 |

## 路径安全

> **所有涉及文件路径操作的代码，必须在服务内部（Python）和 TS 客户端两侧统一使用安全校验函数，禁止自行拼接路径。**

### 总体架构

参照 creator service 现有模式，路径安全分为两层：

| 层级 | 位置 | 函数 | 职责 |
|------|------|------|------|
| **微服务内部** | `build-service/app/safe_path.py` | `resolve_safe_path(base, user_path)` | 所有 FastAPI 路由中涉及 `project_id`、`filename` 拼接时统一调用 |
| **TS 客户端** | `server/db.ts` (已有) | `resolveSafePath(baseDir, fileName)` | 下载/删除文件时校验本地输出路径 |

### Python 端实现

与 creator service 完全一致的 `resolve_safe_path` 函数：

```python
import os

def resolve_safe_path(base: str, user_path: str) -> str:
    """安全解析用户提供的路径段到受信基准目录下。"""
    root = os.path.realpath(base)
    candidate = os.path.realpath(os.path.join(root, user_path))
    if os.path.commonpath([root, candidate]) != root:
        raise ValueError(
            f"Path traversal detected: '{user_path}' resolves outside '{base}'"
        )
    return candidate
```

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
| `routers/build.py` | 构建时读取 `metadata.json`、执行 `npm install/build` | `_project_path()` + `_safe_join()` |
| `routers/file.py` | 列出/下载/删除文件时解析 `project_id` + 拼接 `filename` | `_project_path()` + `_safe_join()` |

**硬性要求**：
- 任何路由中访问项目目录、读写文件前，**必须先调用 `_project_path()`** 校验 `project_id`
- 禁止在路由中直接使用 `os.path.join(PROJECTS_ROOT, project_id)` 或字符串拼接路径
- 上传 tar.gz 解压时必须在 `_project_path()` 返回的目录内操作

## 构建安全

### subprocess 执行安全

- 构建命令在项目目录内执行，使用 `cwd=_project_path(project_id)` 限制工作目录
- 禁止使用 `shell=True`，使用 `subprocess.run([...])` 传递命令数组
- 超时 600s，超时后 `process.kill()` + `process.wait()`
- stdin 重定向到 `/dev/null`，防止构建脚本等待输入
- 环境变量隔离：`PATH` 限制为 `/usr/local/bin:/usr/bin:/bin`，不继承宿主环境

### npm 安全

- `npm install` 使用 `--ignore-scripts` 可选项（默认不禁用，游戏开发需 postinstall 脚本）
- Docker 构建时 `npm cache clean --force` 不作为常规步骤（缓存提速），仅在上传新源码时保留缓存
- 禁止安装全局包（除 Dockerfile 预装阶段外）

## 性能考量

- **npm 缓存**：Dockerfile 预装常用包 + volume 持久化 `/root/.npm`，加速重复构建
- **超时设置**：构建 600s，上传/下载 120s
- **内存**：建议分配 2GB+，npm install 阶段内存消耗较大
- **磁盘**：建议挂载 volume 留 2GB+ 空间，每次构建成功后清理旧 `node_modules`，仅保留日志

## 成本

- 镜像体积 ~180MB（Alpine + Node.js 22 + npm + 预装包 + Python/FastAPI）
- 纯 CPU 运算，无需 GPU
- 每次构建写入磁盘约 50-200MB（node_modules + dist）

## 相关文件

| 文件 | 角色 |
|------|------|
| `build-service/Dockerfile` | 容器构建 |
| `build-service/requirements.txt` | Python 依赖 |
| `build-service/app/main.py` | FastAPI 入口 |
| `build-service/app/schemas.py` | Pydantic 模型 |
| `build-service/app/builder.py` | subprocess 执行器（npm/vite/capacitor） |
| `build-service/app/strategies.py` | GameEngineBuilder：metadata.json 解析 + 策略分发 |
| `build-service/app/safe_path.py` | 路径安全 |
| `build-service/app/routers/project.py` | 项目路由 + 源码上传 |
| `build-service/app/routers/build.py` | 构建触发路由 |
| `build-service/app/routers/file.py` | 文件管理路由 |
| `server/build-service.ts` | TS HTTP 客户端 |
| `server/build-service.d.ts` | TS 类型定义 |
| `server/db.ts` | build_projects 表 + CRUD |
| `server/tools.ts` | 8 个 MCP 工具 + submit_game 流程变更 |
| `server/agent-manager.ts` | ENGINEER_ALLOW 权限 |
| `server/agents.ts` | TOOLS_OVERVIEW + 系统提示词 |
| `docker-compose.yml` | build-service 容器 |

## 测试策略

1. **单元测试**：`strategies.py` GameEngineBuilder 策略分发、`builder.py` subprocess 执行器
2. **集成测试**：docker-compose 拉起 build-service，curl 上传 mock 源码 → 触发构建 → 下载产物
3. **UI Test**：通过 engineer agent 调用 `build_*` 工具，验证全链路（含 submit_game 集成）

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

新增前端交互功能时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
1. `tests/ui/e2e/studio.spec.ts` — 添加测试用例
2. `.agent/memory/E2E_TESTING.md` — 更新测试矩阵、testid 对照表
3. `.agent/specs/` 下对应的 spec 文档 — 更新测试策略章节
4. `.agent/specs/INDEX.md` — 更新索引

## 主动更新所有相关文档规范

实现新功能后，必须主动检查并更新所有受影响的文档：
1. `README.md` + `README.zh-CN.md`
2. `docs/ARCHITECTURE.md` + `docs/ARCHITECTURE.zh-CN.md`
3. `.agent/memory/ARCHITECTURE.md`
4. `.agent/memory/INDEX.md`
5. `.agent/memory/MEMORY.md` — 工程决策记录
6. `.agent/specs/INDEX.md` — spec 索引
7. 不相关的文档不需要修改

## 详细 Debug 日志规范

1. **后端 API 路由**：`console.log('[DEBUG:build-service] stepN: ...')`
2. **前端组件**：`console.log('[DEBUG:ComponentName] ...')`
3. **SSE 事件处理**：`handleSSEEvent` 中添加事件类型日志
4. **E2E 测试**：`process.stderr.write('[UI-XXX] step: ...')`

## 注意事项

- **metadata.json 未找到**：构建前检查，缺失时返回明确错误 `"metadata.json not found in project"`
- **game_type 未注册**：返回明确错误 `"Unknown game_type: xxx. Supported: h5, phaser-mobile"`，不执行
- **npm 缓存**：volume 持久化 `/root/.npm`，Docker 重启后缓存保留
- **node_modules 清理**：每次接收新源码上传时，先删除旧 `node_modules` 目录后重新 `npm install`
- **构建日志**：保留最近一次构建的完整 stdout+stderr 到 `build.log` 文件，可通过文件 API 查看
- **并发构建**：同一 project_id 同时只允许一个构建任务（`build_status == "building"` 时拒绝新请求）
- **文件目录删除**：所有项目目录和文件支持通过 API 删除，DELETE 方法幂等
