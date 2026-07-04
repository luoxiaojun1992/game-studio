# 清理 docker-compose.ui-test.yml 非必要环境变量

> **SPEC-022** | 状态：设计中

## 目标

清除 `docker-compose.ui-test.yml` 中与代码默认值一致的冗余环境变量声明，减少配置文件噪音和维护负担，同时保留 Docker 容器组网必需的覆盖值。

## 背景

### 现状

`docker-compose.ui-test.yml` 当前定义了 60+ 个环境变量，涉及 12 个服务。经逐一对比各服务源码中的默认值，发现约 42% 的环境变量设置值与代码默认值完全相同，属于非必要声明。这些冗余声明增加了 YAML 文件长度、阅读理解负担，以及未来修改时的不一致风险。

**问题**：
1. **噪音过多**：25 个环境变量值与代码默认值完全相同，阅读时难以快速识别真正需要覆盖的关键变量
2. **维护负担**：修改代码默认值时，需同步修改 docker-compose 文件，容易遗漏导致不一致
3. **误导读图**：冗余变量使文件看起来比实际需要更复杂，降低可维护性
4. **drawio-export 死变量**：5 个以 `DRAWIO_` 开头的环境变量不在 jgraph/drawio 官方文档中，可能从未生效

## 架构概述

### 清理范围

```
docker-compose.ui-test.yml (12 services, 60+ env vars)
├── codebuddy-sdk-mock    — 2 env vars
├── minio                 — 2 env vars
├── studio-backend        — 19 env vars (最多)
├── star-office-ui        — 6 env vars
├── creator               — 2 env vars
├── image-service         — 2 env vars
├── video-service         — 2 env vars
├── build-service         — 2 env vars
├── drawio-service        — 3 env vars
├── drawio-export         — 5 env vars (疑似全死)
├── scanner               — 4 env vars
├── sonarqube             — 0 env vars
├── ui-app                — 0 env vars
└── ui-e2e                — 9 env vars
```

### 判断标准

- **冗余**：compose 值与代码默认值完全一致（如 `PORT=3000`，代码中 `process.env.PORT || 3000`）
- **必要**：compose 值覆盖了不同的代码默认值（如服务 URL 从 `localhost` 覆盖为容器名、`*_TEST_MODE=true` 覆盖默认 `false`）
- **不确定**：无法从仓库源码验证（如 drawio-export 的自定义变量、star-office-ui 运行时代码不在仓库中）

## 详细设计

### 1. 逐服务分析

#### 1.1 codebuddy-sdk-mock

| 变量 | Compose 值 | 代码默认值 | 判定 | 操作 |
|------|-----------|-----------|------|------|
| `MOCK_SERVER_PORT` | `3001` | `3001` | 冗余 | **删除** |
| `MOCK_SERVER_HOST` | `0.0.0.0` | `127.0.0.1` | 必要 | **保留**（Docker 需监听所有接口） |

#### 1.2 minio

| 变量 | Compose 值 | MinIO 默认值 | 判定 | 操作 |
|------|-----------|-------------|------|------|
| `MINIO_ROOT_USER` | `minioadmin` | `minioadmin` | 冗余 | **删除** |
| `MINIO_ROOT_PASSWORD` | `minioadmin` | `minioadmin` | 冗余 | **删除** |

#### 1.3 studio-backend（19 → 11 保留）

| 变量 | Compose 值 | 代码默认值 | 判定 | 操作 |
|------|-----------|-----------|------|------|
| `PORT` | `3000` | `3000` | 冗余 | **删除** |
| `CODEBUDDY_API_KEY` | `mock-codebuddy-key` | 无默认 | 必要 | **保留** |
| `CODEBUDDY_BASE_URL` | `http://codebuddy-sdk-mock:3001` | `undefined` | 必要 | **保留** |
| `STAR_OFFICE_UI_URL` | `http://star-office-ui:19000` | `http://127.0.0.1:19000` | 必要 | **保留** |
| `MINIO_ENDPOINT` | `minio:9000` | `localhost:9000` | 必要 | **保留** |
| `MINIO_ACCESS_KEY` | `minioadmin` | `minioadmin` | 冗余 | **删除** |
| `MINIO_SECRET_KEY` | `minioadmin` | `minioadmin` | 冗余 | **删除** |
| `MINIO_USE_SSL` | `false` | `false`（未设置时） | 冗余 | **删除** |
| `MINIO_BUCKET` | `game-files` | `game-files` | 冗余 | **删除** |
| `CREATOR_SERVICE_URL` | `http://creator:8080` | `http://localhost:8080` | 必要 | **保留** |
| `DRAWIO_SERVICE_URL` | `http://drawio-service:8082` | `http://localhost:8082` | 必要 | **保留** |
| `IMAGE_SERVICE_URL` | `http://image-service:8089` | `http://localhost:8089` | 必要 | **保留** |
| `VIDEO_SERVICE_URL` | `http://video-service:8084` | `http://localhost:8084` | 必要 | **保留** |
| `BUILD_SERVICE_URL` | `http://build-service:8085` | `http://localhost:8085` | 必要 | **保留** |
| `SCANNER_SERVICE_URL` | `http://scanner:8081` | `http://localhost:8081` | 必要 | **保留** |
| `STAR_OFFICE_JOIN_KEY` | `ocj_example_team_01` | `ocj_example_team_01` | 冗余 | **删除** |
| `SONARQUBE_HOST` | `http://sonarqube:9000` | `http://localhost:9002` | 必要 | **保留** |
| `SONARQUBE_USER` | `admin` | `admin` | 冗余 | **删除** |
| `SONARQUBE_PASSWORD` | `admin` | `admin` | 冗余 | **删除** |

#### 1.4 star-office-ui（6 → 仅确定项）

| 变量 | Compose 值 | 已知默认值 | 判定 | 操作 |
|------|-----------|-----------|------|------|
| `STAR_BACKEND_PORT` | `19000` | Dockerfile 硬编码 19000 | **不确定** | **保留**（运行时代码不在仓库，无法验证） |
| `STAR_OFFICE_MAX_CONCURRENT` | `100` | `5`（Dockerfile `${VAR:-5}`） | 必要 | **保留** |
| `STAR_OFFICE_JOIN_KEY` | `ocj_example_team_01` | `ocj_example_team_01` | 冗余 | **删除** |
| `STAR_OFFICE_SECRET` | `your-secret-key-here-min-24-chars` | 不在仓库 | **不确定** | **保留** |
| `ASSET_DRAWER_PASS` | `secure-pass-1234` | 不在仓库 | **不确定** | **保留** |
| `FLASK_ENV` | `production` | 不在仓库 | **不确定** | **保留** |

#### 1.5 微服务通用模式

各微服务（creator、image-service、video-service、build-service）均遵循相同模式：`*_PORT` 值与代码/Dockerfile 默认值一致，`*_TEST_MODE=true` 覆盖默认 `false`。

| 服务 | 变量 | Compose 值 | 代码默认值 | 判定 | 操作 |
|------|------|-----------|-----------|------|------|
| creator | `CREATOR_PORT` | `8080` | `8080` | 冗余 | **删除** |
| creator | `CREATOR_SERVICE_TEST_MODE` | `true` | `false` | 必要 | **保留** |
| image-service | `IMAGE_SERVICE_PORT` | `8089` | `8089` | 冗余 | **删除** |
| image-service | `IMAGE_SERVICE_TEST_MODE` | `true` | `false` | 必要 | **保留** |
| video-service | `VIDEO_SERVICE_PORT` | `8084` | `8084` | 冗余 | **删除** |
| video-service | `VIDEO_SERVICE_TEST_MODE` | `true` | `false` | 必要 | **保留** |
| build-service | `BUILD_SERVICE_PORT` | `8085` | `8085` | 冗余 | **删除** |
| build-service | `BUILD_SERVICE_TEST_MODE` | `true` | `false` | 必要 | **保留** |

#### 1.6 drawio-service

| 变量 | Compose 值 | 代码/Dockerfile 默认值 | 判定 | 操作 |
|------|-----------|----------------------|------|------|
| `DRAWIO_SERVICE_PORT` | `8082` | `8082`（Dockerfile `ENV` + Python `os.getenv` 双默认） | 冗余 | **删除** |
| `DRAWIO_EXPORT_URL` | `http://drawio-export:8080/export` | `http://drawio-export:8080/export`（Dockerfile `ENV` + Python 双默认） | 冗余 | **删除** |
| `DRAWIO_SERVICE_TEST_MODE` | `true` | `false` | 必要 | **保留** |

#### 1.7 drawio-export（jgraph/drawio:latest）

| 变量 | Compose 值 | 官方文档 | 判定 | 操作 |
|------|-----------|---------|------|------|
| `DRAWIO_VIEWER` | `false` | **不在官方文档中** | 疑似死变量 | **删除** |
| `DRAWIO_RELATIVE_URL` | `false` | **不在官方文档中** | 疑似死变量 | **删除** |
| `DRAWIO_SAVE_URL` | `false` | **不在官方文档中** | 疑似死变量 | **删除** |
| `DRAWIO_DISABLED_EXPORT` | `false` | **不在官方文档中** | 疑似死变量 | **删除** |
| `JGRAPH_URL_BASE` | `http://drawio-export:8080` | **不在官方文档中** | 疑似死变量 | **删除** |

> **依据**：jgraph/docker-drawio 官方文档（https://github.com/jgraph/docker-drawio）未列出上述任何变量。drawio-export 容器仅作为导出服务器被 drawio-service 通过 `/export` 端点调用，不需要这些变量。且变量名 `DRAWIO_DISABLED_EXPORT=false` 逻辑矛盾（"禁用导出=false"意味着导出启用，这是默认行为）。

#### 1.8 scanner

| 变量 | Compose 值 | 代码默认值 | 判定 | 操作 |
|------|-----------|-----------|------|------|
| `SCANNER_PORT` | `8081` | `8081` | 冗余 | **删除** |
| `SONAR_HOST_URL` | `http://sonarqube:9000` | `http://sonarqube:9000` | 冗余 | **删除** |
| `SONAR_USER` | `admin` | `admin` | 冗余 | **删除** |
| `SONAR_PASSWORD` | `admin` | `admin` | 冗余 | **删除** |

#### 1.9 ui-e2e

| 变量 | Compose 值 | 代码默认值 | 判定 | 操作 |
|------|-----------|-----------|------|------|
| `UI_BASE_URL` | `http://ui-app` | `http://localhost:4173` | 必要 | **保留** |
| `STUDIO_API_BASE` | `http://studio-backend:3000` | `http://localhost:3000` | 必要 | **保留** |
| `STAR_OFFICE_API_BASE` | `http://star-office-ui:19000` | `http://localhost:19000` | 必要 | **保留** |
| `CODEBUDDY_MOCK_ADMIN_URL` | `http://codebuddy-sdk-mock:3001` | `http://localhost:3001` | 必要 | **保留** |
| `UI_COVERAGE_THRESHOLD` | `90` | `90` | 冗余 | **删除** |
| `UI_TEST_LOOP_TIMEOUT_MS` | `600000` | `'600000'` | 冗余 | **删除** |
| `ALLURE_RESULTS_DIR` | `artifacts/allure-results` | `artifacts/allure-results` | 冗余 | **删除** |
| `HOME` | `/tmp` | 非代码默认，运行时配置 | 必要 | **保留** |
| `NPM_CONFIG_CACHE` | `/tmp/.npm` | 非代码默认，运行时配置 | 必要 | **保留** |

### 2. 清理统计

| 类别 | 数量 | 说明 |
|------|------|------|
| **确定冗余** | 25 | 与代码默认值完全一致的变量 |
| **疑似死变量** | 5 | drawio-export 的 5 个非官方变量 |
| **合计删除** | **30** | 占总量 ~50% |
| **必要保留** | ~30 | 服务发现 URL、TEST_MODE、GitHub Actions 传递的 UID/GID 等 |
| **不确定保留** | 4 | star-office-ui 运行时代码不在仓库中的变量 |

### 3. GitHub Actions 传递的环境变量

GitHub Actions CI（`.github/workflows/ci.yml`）通过 `env UID="$(id -u)" GID="$(id -g)"` 传递 `UID` 和 `GID`，对应 docker-compose 中 `user: "${UID:-1000}:${GID:-1000}"`。`$UID` / `$GID` 变量引用不受本次清理影响。

## 可行性分析

| 检查项 | 结论 |
|--------|------|
| 是否需要后端改动 | 否 — 仅修改 docker-compose 配置文件 |
| 数据是否已存在 | N/A — 不涉及数据 |
| 是否需要新 DB 表 | 否 |
| 是否影响现有功能 | 否 — 删除的变量值与默认值一致，移除后行为不变 |
| 性能影响 | 无 — 仅在容器启动时读取环境变量 |
| 是否需要新增 SSE 事件 | 否 |
| 是否需要 E2E 测试 | 是 — 需运行现有 UI test 套件验证清理后服务正常运行 |

### 结论

纯配置文件清理，删除的是与代码默认值相同的冗余声明 + drawio-export 的 5 个疑似死变量。风险极低，唯一需验证的是 drawio-export 那 5 个变量确实不影响导出功能。建议通过 UI test 验证。

## 相关文件

| 文件 | 角色 | 变更幅度 |
|------|------|---------|
| `docker-compose.ui-test.yml` | 核心变更 | 中（删除 ~30 行环境变量声明） |
| `.agent/specs/docker-compose-ui-test-cleanup.md` | 本文档 | 新增 |

## 测试策略

1. **E2E 测试**：
   - 运行全量 UI test 套件（`docker compose -f docker-compose.ui-test.yml up --abort-on-container-exit --exit-code-from ui-e2e`）
   - 预期：所有 16 个用例通过，无回归
   - 重点验证 drawio 相关用例（UI-009/UI-010）确保导出功能不受影响

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

本次为配置文件清理，不涉及前端功能变更，无需新增 E2E 测试用例。但实现后必须：

1. 运行现有 UI test 全量套件，确保 16 个用例全部通过
2. 如果 drawio 相关用例失败，回滚 drawio-export 相关变量删除
3. 更新 `.agent/memory/E2E_TESTING.md` 无需变更（无新增/删除用例）
4. `.agent/specs/INDEX.md` — 新增 SPEC-022 索引条目，状态更新为"已实现"

## 详细 Debug 日志规范

本节不适用 — 无代码逻辑变更，仅为 YAML 配置清理。

## 验证标准

1. `docker compose -f docker-compose.ui-test.yml config` 无语法错误
2. `docker compose -f docker-compose.ui-test.yml up` 所有 12 个服务 healthy
3. 全量 UI test 16/16 用例通过
4. 清理后的环境变量数量从 ~60 减少到 ~30（减少 ~50%）
5. drawio 导出功能（UI-009/UI-010）正常

## 注意事项

- **drawio-export 的 5 个变量**：官方文档未收录，但实现前建议在 drawio-export 容器内验证（`docker exec drawio-export env | grep DRAWIO`）确认这些变量未被读取
- **star-office-ui 的 4 个不确定变量**：由于运行时代码从 GitHub Release 下载，不在仓库中，保守保留不做删除
- **删除顺序**：建议先删除确定冗余的 25 个变量 → 跑通 UI test → 再删除 drawio-export 的 5 个变量 → 再次跑通，分批降低风险
