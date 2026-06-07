# 游戏测试微服务规范

> **SPEC-013** | 状态：设计中

## 目标

构建游戏测试微服务（`test-service`），为 game-studio 提供基于 Playwright 的自动化游戏测试能力。测试服务直接对接 run-service，通过 run-service 的 `project_id` 定位被测游戏，自动注入运行环境配置后执行测试脚本，生成包含文本和截图的测试报告供 engineer agent 审阅。

核心流程：engineer 上传 Playwright 测试脚本到 test-service（指定 `run_project_id`）→ test-service 自动拼接 run-service 的 host + endpoint + `run_project_id` 注入测试环境 → 执行 `npx playwright test` → 收集测试报告（文本 + 截图）→ engineer 下载审阅。

> **被测定位于 run-service**：test-service 不直接操作游戏源码，而是通过 run-service 的静态伺服端点（`http://run-service:8087/{run_project_id}/`）访问被测游戏。`project_id` 使用 run-service 的 project_id，不是 backend service 的 project_id。

## 配置自动注入

### 设计原则

测试脚本**禁止硬编码** run-service 地址或 project_id。test-service 在执行测试前自动生成环境配置，测试脚本通过标准方式读取。

### 注入机制

test-service 在运行测试前，将以下环境变量注入 Playwright 进程：

| 环境变量 | 值 | 说明 |
|---------|-----|------|
| `GAME_URL` | `http://run-service:8087/{run_project_id}/` | 被测游戏的完整伺服地址 |
| `RUN_PROJECT_ID` | `run_project_id` | 当前被测项目的 run-service project_id |
| `RUN_SERVICE_HOST` | `http://run-service:8087` | run-service 静态伺服根地址 |

### 测试脚本编写规范

测试脚本通过 `process.env.GAME_URL` 访问被测游戏地址：

```typescript
// ✅ 正确：通过环境变量获取游戏地址
import { test, expect } from '@playwright/test';

test('game loads correctly', async ({ page }) => {
  const gameUrl = process.env.GAME_URL!;
  await page.goto(gameUrl);
  await expect(page.locator('canvas')).toBeVisible();
});

// ❌ 错误：硬编码地址
test('game loads', async ({ page }) => {
  await page.goto('http://run-service:8087/abc-123/');  // 禁止！
});
```

### Playwright 配置模板

test-service 内置 Playwright 配置模板，测试执行时自动合并用户上传的 `playwright.config.ts`（如有）：

```typescript
// test-service 内置基础配置
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // 合并用户配置的 baseURL（用户可通过 process.env.GAME_URL 覆盖）
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  // 报告输出到固定目录，供 API 下载
  reporter: [
    ['html', { outputFolder: '/app/data/projects/{run_project_id}/playwright-report', open: 'never' }],
    ['json', { outputFile: '/app/data/projects/{run_project_id}/test-results.json' }],
    ['list'],
  ],
  timeout: 30000,
  retries: 1,
  workers: 1,
  // 输出目录在项目目录内
  outputDir: '/app/data/projects/{run_project_id}/test-artifacts',
});
```

> 用户可通过上传自定义 `playwright.config.ts` 覆盖部分配置（如 `timeout`、`retries`、`testDir`），但 `reporter` 和 `outputDir` 由 test-service 强制管理以保证报告目录可控。

## 架构概述

```
test-service/ (FastAPI + Playwright, port 8088)
├── app/main.py              # FastAPI entrypoint + /health
├── app/schemas.py           # Pydantic 请求/响应模型
├── app/test_runner.py       # Playwright subprocess 执行器（npx playwright test）
├── app/config_injector.py   # 配置注入器：生成 .env 文件 + playwright 配置
├── app/safe_path.py         # 统一路径安全校验函数（resolve_safe_path）
├── app/routers/
│   ├── project.py           # 项目 CRUD（namespace = run_project_id）
│   ├── test.py              # 测试执行/状态/报告下载
│   └── file.py              # 文件列表/下载/删除
├── requirements.txt
├── playwright.config.base.ts  # Playwright 基础配置模板
└── Dockerfile (playwright/python 官方镜像, ~3GB)

server/
├── test-service.ts          # TS 客户端 (testFetch, createTestProject, uploadScript, runTest, ...)
├── test-service.d.ts        # TypeScript 类型定义
├── tools.ts                 # MCP 工具注册 (test_upload_script, test_run, test_download_report, ...)
├── db.ts                    # SQLite test_projects 表
├── agent-manager.ts         # ENGINEER_ALLOW 权限
└── agents.ts                # 系统提示词 + TOOLS_OVERVIEW
```

### 与其他 Service 的对照

| 维度 | Video Service (FFmpeg) | Run Service (Nginx) | Test Service (Playwright) |
|------|----------------------|---------------------|--------------------------|
| 镜像 | alpine:3.21 + ffmpeg | alpine:3.21 + nginx | `playwright/python:v1.52-jammy` |
| 镜像大小 | ~120MB | ~25MB | ~3GB（含所有浏览器） |
| 端口 | 8084 | 8086 + 8087 | 8088 |
| 核心工具 | `ffmpeg` | `nginx` | `npx playwright test` |
| 执行方式 | subprocess 一次性命令 | 容器启动持续运行 | subprocess 一次性命令（含超时） |
| 项目存储 | `/app/data/projects/{id}` | `/app/data/projects/{id}` | `/app/data/projects/{run_project_id}` |
| 超时 | 300s | N/A | 600s（测试执行） |
| 配置注入 | 无 | 无 | **自动注入** GAME_URL + RUN_PROJECT_ID |

## API 设计

### 项目管理（namespace = run_project_id）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{run_project_id}` | 创建测试项目目录（幂等） |
| GET | `/api/projects/{run_project_id}` | 查询项目状态与测试记录 |
| DELETE | `/api/projects/{run_project_id}` | 删除项目目录（幂等） |

### 测试脚本上传

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects/{run_project_id}/upload-script` | 上传 Playwright 测试脚本（tar.gz），解压到项目 `tests/` 目录 |

**上传包结构示例：**

```
test-scripts.tar.gz
├── tests/
│   ├── game.spec.ts          # 测试用例（必须）
│   └── helpers.ts            # 辅助函数（可选）
├── playwright.config.ts      # 自定义配置（可选，部分字段被 test-service 覆盖）
└── package.json              # npm 依赖声明（可选，默认安装 @playwright/test）
```

> 上传时校验 `tests/` 目录下至少存在一个 `.spec.ts` 或 `.test.ts` 文件。

### 测试执行与报告

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/test/{run_project_id}/run` | 触发测试执行（异步，返回 test_run_id） |
| GET | `/api/test/{run_project_id}/status` | 查询测试运行状态与结果摘要 |
| GET | `/api/test/{run_project_id}/report` | 下载完整测试报告（HTML zip，含内嵌截图） |

### 文件管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/{run_project_id}` | 列出项目文件（递归） |
| GET | `/api/files/{run_project_id}/{filename}` | 下载单文件 |
| DELETE | `/api/files/{run_project_id}/{filename}` | 删除文件（幂等） |

> **路径安全**：以上所有端点中涉及 `run_project_id` 拼接、`filename` 路径操作时，必须通过 `_project_path()` + `_safe_join()` 校验（详见 [路径安全](#路径安全) 章节）。

### 通用响应格式

```json
// 脚本上传成功
{
  "success": true,
  "message": "Test scripts uploaded to project abc-123",
  "test_files": ["tests/game.spec.ts", "tests/helpers.ts"],
  "config_file": "playwright.config.ts"
}

// 测试触发成功
{
  "success": true,
  "test_run_id": "run-abc123-001",
  "message": "Test run started",
  "game_url": "http://run-service:8087/abc-123/",
  "run_project_id": "abc-123"
}

// 测试状态（运行中）
{
  "test_run_id": "run-abc123-001",
  "status": "running",
  "started_at": "2026-06-05T02:30:00Z"
}

// 测试状态（完成）
{
  "test_run_id": "run-abc123-001",
  "status": "completed",
  "started_at": "2026-06-05T02:30:00Z",
  "finished_at": "2026-06-05T02:31:23Z",
  "duration_seconds": 83,
  "summary": {
    "total": 5,
    "passed": 4,
    "failed": 1,
    "skipped": 0,
    "flaky": 0
  },
  "failures": [
    {
      "test": "tests/game.spec.ts:15 › score display updates correctly",
      "error": "Expected 100 but got 0",
      "screenshot": "test-artifacts/failure-1.png"
    }
  ]
}

// 测试失败 (422)
{
  "detail": "No .spec.ts or .test.ts files found in tests/ directory"
}
```

## 输入校验规则

| 字段 | 规则 |
|------|------|
| `run_project_id` | 正则 `/^[a-zA-Z0-9_-]{1,64}$/` |
| 上传文件大小 | 最大 10MB（测试脚本，不含 node_modules） |
| 上传文件格式 | `application/gzip`（tar.gz） |
| 测试脚本语言 | TypeScript（`.spec.ts` 或 `.test.ts`） |
| 测试超时 | 默认 600s，可通过上传的 `playwright.config.ts` 覆盖 `timeout` |

## 测试执行流程

```
POST /api/test/{run_project_id}/run 触发：

1. 校验 run_project_id 对应的项目目录存在且包含 tests/
2. 检查 tests/ 下至少一个 .spec.ts/.test.ts 文件
3. 生成 .env 文件到项目目录：
   GAME_URL=http://run-service:8087/{run_project_id}/
   RUN_PROJECT_ID={run_project_id}
   RUN_SERVICE_HOST=http://run-service:8087

4. 合并 Playwright 配置：
   - 基础: playwright.config.base.ts（test-service 内置）
   - 覆盖: 用户上传的 playwright.config.ts（如有）
   - 强制: reporter/outputDir 使用项目目录路径

5. npm install（如用户上传了 package.json）或默认安装 @playwright/test
6. 设置环境变量并执行：
   GAME_URL=http://run-service:8087/{run_project_id}/ \
   RUN_PROJECT_ID={run_project_id} \
   npx playwright test --config=/app/data/projects/{run_project_id}/playwright.config.ts

7. 解析 test-results.json，生成摘要响应
8. 收集截图（test-artifacts/）打包进报告
```

### 报告内容

测试报告包含以下可审计内容：

| 内容 | 格式 | 说明 |
|------|------|------|
| 测试摘要 | JSON | 通过/失败/跳过数量和耗时 |
| 失败详情 | JSON | 每个失败用例的错误信息 + 堆栈 |
| 失败截图 | PNG | 失败时的页面截图（Playwright 自动捕获） |
| trace 文件 | zip | 失败用例的 Playwright Trace（可选，用于深度调试） |
| HTML 报告 | HTML | Playwright HTML Reporter 生成的可视化报告 |

## 数据模型

### `test_projects` 表（SQLite）

```sql
CREATE TABLE IF NOT EXISTS test_projects (
  id TEXT PRIMARY KEY,
  run_project_id TEXT NOT NULL UNIQUE,
  test_project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_projects_run ON test_projects(run_project_id);
```

### `test_runs` 表（SQLite）

```sql
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  run_project_id TEXT NOT NULL,
  test_run_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  summary TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_runs_project ON test_runs(run_project_id);
```

`status` 枚举：`"pending"` | `"running"` | `"completed"` | `"failed"` | `"timeout"`

## MCP 工具清单（8 个）

所有工具仅 **engineer** 可用，无需审批，`ENGINEER_ALLOW` 自动放行。

| 工具名 | 说明 |
|--------|------|
| `test_create_project` | 创建测试 project（传入 run_project_id） |
| `test_delete_project` | 删除测试 project 及所有文件 |
| `test_upload_script` | 上传 Playwright 测试脚本到指定 run_project_id |
| `test_run` | 触发测试执行（自动注入 run-service 配置） |
| `test_status` | 查询测试运行状态与结果摘要 |
| `test_download_report` | 下载完整测试报告（HTML + 截图） |
| `test_list_files` | 列出项目文件 |
| `test_delete_file` | 删除项目内文件 |

## 集成要点

### 与 run-service 的关系

```
engineer 调用 test_run → test-service 自动构造 GAME_URL
                                    ↓
              http://run-service:8087/{run_project_id}/
                                    ↓
                         run-service Nginx 伺服游戏
```

test-service **依赖 run-service** 的健康状态：
- 触发测试前，test-service 应检查 `http://run-service:8087/{run_project_id}/` 可访问
- 若 run-service 不可达，返回明确错误，不执行测试

### Docker Compose

```yaml
test-service:
  build:
    context: ./test-service
    dockerfile: Dockerfile
  container_name: game-studio-test-service
  ports:
    - "${TEST_SERVICE_PORT:-8088}:8088"
  environment:
    - TEST_SERVICE_PORT=8088
    - RUN_SERVICE_HOST=http://run-service:8087
  volumes:
    - test-data:/app/data
  networks:
    - game-studio-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8088/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
  restart: unless-stopped
  depends_on:
    run-service:
      condition: service_healthy
```

新增 volume：`test-data`。

Backend 环境变量：
```
TEST_SERVICE_URL=http://test-service:8088
```

### Dockerfile

```dockerfile
FROM mcr.microsoft.com/playwright/python:v1.52.0-jammy

# Playwright 官方镜像已包含：
# - Python 3.12
# - Node.js 22
# - Playwright + Chromium/Firefox/WebKit 浏览器
# - npx 命令

WORKDIR /app

# 创建数据目录
RUN mkdir -p /app/data/projects /app/playwright-base

# 预装 @playwright/test（npm）
RUN npm install -g @playwright/test

# Python FastAPI 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

# Playwright 基础配置模板
COPY playwright.config.base.ts /app/playwright-base/

COPY app/ ./app/

EXPOSE 8088

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088"]
```

> **镜像大小估算**：`playwright/python:v1.52.0-jammy` ~2.8GB + FastAPI ~100MB + npm 包 ~50MB ≈ **~3GB**。
> 与 creator service (Blender, ~2GB+) 同属重型镜像，可接受。使用官方 Playwright Docker 镜像确保浏览器兼容性。

### 端口分配总览

| 服务 | 端口 | 状态 |
|------|------|------|
| creator (Blender) | 8080 | 已实现 |
| scanner (Sonar) | 8081 | 已实现 |
| drawio-service | 8082 | 已实现 |
| drawio-export | 8083 | 已实现 |
| image-service (ImageMagick) | 8089 | 设计中 |
| video-service (FFmpeg) | 8084 | 设计中 |
| build-service (Node.js) | 8085 | 设计中 |
| run-service API | 8086 | 设计中 |
| run-service 静态伺服 | 8087 | 设计中 |
| **test-service** | **8088** | 设计中 |

## 路径安全

> **所有涉及文件路径操作的代码，必须在服务内部（Python）和 TS 客户端两侧统一使用安全校验函数，禁止自行拼接路径。**

### 总体架构

| 层级 | 位置 | 函数 | 职责 |
|------|------|------|------|
| **微服务内部** | `test-service/app/safe_path.py` | `resolve_safe_path(base, user_path)` | 所有 FastAPI 路由中涉及 `run_project_id`、`filename` 拼接时统一调用 |
| **TS 客户端** | `server/db.ts` (已有) | `resolveSafePath(baseDir, fileName)` | 下载报告/删除文件时校验本地输出路径 |

### 路由层使用规范

```python
from app.safe_path import resolve_safe_path

PROJECTS_ROOT = "/app/data/projects"

def _project_path(run_project_id: str) -> str:
    try:
        return resolve_safe_path(PROJECTS_ROOT, run_project_id)
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
| `routers/project.py` | 上传、创建、删除时解析 `run_project_id` | `_project_path()` |
| `routers/test.py` | 读写测试脚本、生成配置、读取报告 | `_project_path()` + `_safe_join()` |
| `routers/file.py` | 列出/下载/删除文件 | `_project_path()` + `_safe_join()` |

**硬性要求**：
- 上传 tar.gz 解压时必须在 `_project_path()` 返回的目录内操作
- Playwright config 生成、.env 写入、报告输出路径均通过 `_safe_join()` 校验
- 下载报告时 TS 侧使用 `resolveSafePath` 限制输出到 `/app/output/{projectId}/tests/`

## 测试执行安全

### subprocess 安全

- Playwright 通过 `subprocess.run([...])` 执行，禁止 `shell=True`
- 环境变量通过 `env={**os.environ, ...}` 注入，不拼接 shell 命令
- 工作目录限制为 `_project_path(run_project_id)`
- 超时 600s，超时后 `process.kill()` + `process.wait()`

### Playwright 浏览器安全

- 浏览器在 Docker 容器中运行，与宿主机完全隔离
- `--no-sandbox` 标志由 Playwright Docker 镜像自动处理
- 浏览器仅访问 `GAME_URL` 指向的 run-service 地址（容器内网，不访问外网）

### 脚本安全

- 上传的测试脚本仅做语法校验，不限制具体测试内容
- npm install 默认执行（测试需安装依赖），使用 `--ignore-scripts` 可选（视测试需求）
- 禁止安装全局 npm 包

## 性能考量

- **并发测试**：`workers: 1`（单 worker，避免浏览器资源竞争）
- **超时设置**：测试总超时 600s，单个用例默认 30s
- **内存**：Playwright + Chromium 约 500MB，建议分配 2GB+
- **磁盘**：每次测试运行约 10-100MB（截图 + trace + 报告），建议挂载 volume 2GB+
- **启动时间**：首次 `npx playwright test` 时浏览器缓存 warm up 约 10s

## 成本

- 镜像体积 ~3GB（Playwright 官方镜像 + 所有浏览器）
- 纯 CPU 运算，无需 GPU（Playwright 使用无头浏览器，纯 CPU 渲染）
- 与 creator service (Blender, ~2GB+) 同属重型镜像，可接受
- 测试执行时 CPU 和内存峰值较高，建议独立调度

## 使用场景

1. **游戏功能测试**：engineer 构建完成后自动运行 E2E 测试
2. **回归测试**：修改游戏逻辑后验证已有功能不被破坏
3. **截图对比**：对比不同版本的游戏画面变化
4. **性能基准**：测试游戏加载时间、帧率等性能指标

## 相关文件

| 文件 | 角色 |
|------|------|
| `test-service/Dockerfile` | 容器构建 |
| `test-service/playwright.config.base.ts` | Playwright 基础配置模板 |
| `test-service/requirements.txt` | Python 依赖 |
| `test-service/app/main.py` | FastAPI 入口 |
| `test-service/app/schemas.py` | Pydantic 模型 |
| `test-service/app/test_runner.py` | Playwright subprocess 执行器 |
| `test-service/app/config_injector.py` | 配置注入器（.env 生成 + playwright.config 合并） |
| `test-service/app/safe_path.py` | 路径安全 |
| `test-service/app/routers/project.py` | 项目路由 + 脚本上传 |
| `test-service/app/routers/test.py` | 测试执行/状态/报告下载 |
| `test-service/app/routers/file.py` | 文件管理路由 |
| `server/test-service.ts` | TS HTTP 客户端 |
| `server/test-service.d.ts` | TS 类型定义 |
| `server/db.ts` | test_projects + test_runs 表 + CRUD |
| `server/tools.ts` | 8 个 MCP 工具 |
| `server/agent-manager.ts` | ENGINEER_ALLOW 权限 |
| `server/agents.ts` | TOOLS_OVERVIEW + 系统提示词 |
| `docker-compose.yml` | test-service 容器（depends_on run-service） |

## 测试策略

1. **集成测试**：docker-compose 拉起 test-service + run-service，curl 上传测试脚本 → 触发测试 → 下载报告
2. **UI Test**：通过 engineer agent 调用 `test_*` 工具，验证全链路

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

1. **后端 API 路由**：`console.log('[DEBUG:test-service] stepN: ...')`
2. **E2E 测试**：`process.stderr.write('[UI-XXX] step: ...')`

## 注意事项

- **project 删除**：`DELETE /api/projects/{run_project_id}` 为**整体目录删除**（`shutil.rmtree`），删除项目根目录及其下所有文件（含测试脚本、报告、截图）。与 sonar/scanner project 不同（sonar project 复用，不删除），本服务的 project 存储为独立临时工作目录，删除后无法恢复。
- **run_project_id 命名空间**：test-service 使用 run-service 的 project_id 作为项目标识，不是 backend service 的 project_id。确保调用方传递正确的 ID
- **配置禁止硬编码**：测试脚本中不得出现任何 `run-service` 地址、端口、project_id 等硬编码值，必须通过 `process.env.GAME_URL` 获取
- **Playwright 报告**：使用 HTML reporter（含内嵌截图）作为主报告格式，JSON reporter 作为机器可读摘要
- **npm install 时机**：每次上传新脚本后清空 `node_modules`，首次 `test_run` 时执行 `npm install`
- **文件目录删除**：所有项目目录和文件支持通过 API 删除，DELETE 方法幂等
- **镜像体积**：Playwright 官方镜像 ~3GB，首次 pull 时间较长，建议 CI 中做镜像缓存
- **run-service 依赖**：test-service 通过 `depends_on run-service` 确保启动顺序，但仍需在运行时检查 run-service 健康状态
- **非真机测试**：test-service 仅在容器中运行无头浏览器测试，不连接真机。相关真机测试需求后续迭代
