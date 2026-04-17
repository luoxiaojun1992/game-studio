# Game Dev Studio

[English](./README.md)

一个基于 CodeBuddy Agent SDK 的多 Agent 游戏研发工作台，提供团队协作、提案评审、任务看板、任务交接、游戏产出、运行观测与 Star-Office-UI 联动能力。

## 功能概览

- 多角色 Agent 团队（工程师、架构师、游戏策划、商业策划、CEO、团队建设）
- 指令中心（向指定 Agent 下达任务，SSE 流式回传）
- Studio 联动（内嵌 Star-Office-UI，状态双向同步）
- 任务看板（开发/测试任务拆分与状态流转）
- 任务交接（跨角色移交、确认执行、完成回传）
- 项目设置（自动交接开关）
- 提案管理（创建、评审、人工决策）
- 游戏成品管理（HTML 成品提交、预览、版本状态）
- Agent 长期记忆（保存/查询/清理）
- 项目隔离（按 `project_id` 隔离数据与观测流）

## 界面预览

![团队总览](./docs/images/team.zh-CN.png)
![Studio 工作台](./docs/images/studio.zh-CN.png)
![策划案](./docs/images/proposal.zh-CN.png)
![任务看板](./docs/images/task.zh-CN.png)
![任务交接](./docs/images/handoff.zh-CN.png)
![配置中心](./docs/images/setting.zh-CN.png)
![游戏成品](./docs/images/artifact.zh-CN.png)
![运行日志](./docs/images/log.zh-CN.png)
![指令中心](./docs/images/command.zh-CN.png)

## 技术栈

- 后端：Node.js + Express + TypeScript
- 前端：React 18 + TypeScript + Vite
- 数据库：SQLite（`better-sqlite3`）
- UI：TDesign React
- AI：`@tencent-ai/agent-sdk`

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量（可选但推荐）

```bash
cp .env.example .env
```

- 若需调用大模型，请在 `.env` 中配置 `CODEBUDDY_API_KEY`（或运行环境注入 `CODEBUDDY_AUTH_TOKEN`）。
- 若未配置密钥，系统仍可启动，但 AI 能力会受限。

### 3) 启动开发环境（前后端）

```bash
npm run dev
```

- 前端默认：`http://localhost:5173`
- 后端默认：`http://localhost:3000`

### 4) 构建

```bash
npm run build
```

## 常用脚本

```bash
# 前后端联调
npm run dev

# 仅后端（tsx 直接运行）
npm run dev:server

# 仅前端
npm run dev:client

# 生产构建
npm run build

# 预览前端构建产物
npm run preview

# 直接启动后端入口
npm run server
```

## 关键环境变量（本地开发）

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 3000 | 后端服务监听端口 |
| `CODEBUDDY_BASE_URL` | 空 | 可选 SDK 端点覆盖（如本地 mock server） |
| `CODEBUDDY_API_KEY` | 空 | 模型调用 API Key |
| `CODEBUDDY_AUTH_TOKEN` | 空 | 运行时鉴权 Token（可替代 API Key） |
| `VITE_API_BASE` | `http://localhost:3000` | 前端 API 基地址 |
| `VITE_STAR_OFFICE_UI_URL` | `http://127.0.0.1:19000` | 前端 Studio 页签嵌入地址 |
| `STAR_OFFICE_UI_URL` | `http://127.0.0.1:19000` | 后端同步服务基础地址 |
| `STAR_OFFICE_JOIN_KEY` | `ocj_example_team_01` | Agent 注册密钥 |
| `STAR_OFFICE_SYNC_DEBOUNCE_MS` | 300 | 状态同步防抖时间（毫秒） |
| `STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS` | 10000 | Star Office 健康检查周期（毫秒） |

## Docker 部署

如需容器化部署，请参考 [README-Docker.zh-CN.md](./docs/README-Docker.zh-CN.md)。

## 目录结构

```text
game-studio/
├── server/                 # 后端服务与 Agent 编排
│   ├── index.ts            # API 与 SSE 入口
│   ├── agent-manager.ts    # Agent 生命周期与消息分发
│   ├── tools.ts            # MCP 自定义工具
│   ├── agents.ts           # 团队角色定义与系统提示词
│   ├── star-office-sync.ts # Star-Office-UI 同步服务
│   └── db.ts               # SQLite 表结构与数据访问
├── src/                    # 前端应用
│   ├── pages/StudioPage.tsx
│   ├── components/         # 各业务面板
│   ├── config.ts           # API 封装
│   └── types.ts            # 前后端共享业务类型
├── star-office-ui/         # Star-Office-UI Docker 构建资源
├── docs/images/            # README 预览图片
├── data/                   # SQLite 数据文件目录（运行时生成）
├── output/                 # 提案/游戏产出目录（运行时生成）
├── docker-compose.yml
├── README.md
├── docs/
│   ├── README-Docker.md
│   ├── README-Docker.zh-CN.md
│   ├── DEVELOPMENT.md
│   ├── DEVELOPMENT.zh-CN.md
│   ├── ARCHITECTURE.md
│   ├── ARCHITECTURE.zh-CN.md
│   └── images/
└── README.zh-CN.md
```

## API 概览

主要接口（前缀 `/api`）：

- 基础：`/health` `/models` `/check-login` `/observe`
- Agent：`/agents` `/agents/:agentId/messages` `/agents/:agentId/command` `/agents/:agentId/pause` `/agents/:agentId/resume`
- 提案：`/proposals` `/proposals/:id` `/proposals`(POST) `/proposals/:id/review` `/proposals/:id/decide`
- 游戏：`/games` `/games/:id` `/games`(POST) `/games/:id/preview` `/games/:id`(PATCH)
- 项目：`/projects`(GET/POST) `/projects/switch`(POST) `/projects/:id/settings`(GET/PATCH)
- 交接：`/handoffs` `/handoffs/pending` `/handoffs/:id/(accept|confirm|complete|reject|cancel)`
- 任务：`/tasks` `/tasks/:id/status`
- 记忆：`/agents/:agentId/memories`(GET/POST/DELETE) `/memories` `/memories/:id`
- 日志：`/projects/:projectId/logs`(GET/DELETE)
- 会话与指令：`/agents/:agentId/messages`(DELETE) `/commands`
- 权限：`/permission-response`

## 项目与数据产出

- 支持多项目隔离（`project_id`）。
- 提案与游戏提交时会同步写入 `output/{project_id}/...` 目录。
- `/output` 提供静态访问（HTML 以 `text/html; charset=utf-8` 返回）。

## 二次开发

详见 [DEVELOPMENT.zh-CN.md](./docs/DEVELOPMENT.zh-CN.md)。

## 架构文档

详见 [ARCHITECTURE.zh-CN.md](./docs/ARCHITECTURE.zh-CN.md)。


## UI 测试

```bash
# 推荐：使用 docker compose 一键运行完整 UI 测试
mkdir -p tests/ui/artifacts
docker compose -f docker-compose.ui-test.yml up --build --abort-on-container-exit --exit-code-from ui-e2e
```

- Playwright 视频/trace 与报告输出在 `tests/ui/artifacts/`。
- UI 测试覆盖率汇总输出在 `tests/ui/artifacts/ui-coverage-summary.json`，阈值要求为 90%。
- 本地手动运行（需分终端）：

```bash
# 启动前先安装依赖（一次即可）
npm ci

# 终端 1：启动 CodeBuddy SDK mock server
npm run mock:server

# 终端 2：启动 Studio 后端（真实 /api/*），并将 CodeBuddy SDK 请求指向 mock server
CODEBUDDY_BASE_URL=http://localhost:3001 CODEBUDDY_API_KEY=mock-codebuddy-key STAR_OFFICE_UI_URL=http://127.0.0.1:19000 npm run server

# 终端 3：启动前端并指向真实 Studio 后端
VITE_API_BASE=http://localhost:3000 VITE_STAR_OFFICE_UI_URL=http://127.0.0.1:19000 npm run dev:client -- --host 0.0.0.0 --port 4173

# 终端 4：执行 UI 测试 + 覆盖率 + allure 产物
STUDIO_API_BASE=http://localhost:3000 STAR_OFFICE_API_BASE=http://localhost:19000 CODEBUDDY_MOCK_ADMIN_URL=http://localhost:3001 npm run test:ui:ci
```
