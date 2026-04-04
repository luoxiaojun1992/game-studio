# Game Dev Studio

一个基于 CodeBuddy Agent SDK 的多 Agent 游戏研发工作台，提供团队协作、提案评审、任务看板、任务交接、游戏产出与运行观测能力。

## 功能概览

- 多角色 Agent 团队（工程师、架构师、游戏策划、商业策划、CEO）
- 指令中心（向指定 Agent 下达任务，SSE 流式回传）
- 任务看板（开发/测试任务拆分与状态流转）
- 任务交接（跨角色移交、确认执行、完成回传）
- 项目设置（自动交接开关）
- 提案管理（创建、评审、人工决策）
- 游戏成品管理（HTML 成品提交、预览、版本状态）
- Agent 长期记忆（保存/查询/清理）
- 项目隔离（按 project_id 隔离数据与观测流）

## 界面预览

![团队总览](./docs/images/team.png)
![策划案](./docs/images/proposal.png)
![任务看板](./docs/images/task.png)
![任务交接](./docs/images/handoff.png)
![游戏成品](./docs/images/artifact.png)
![运行日志](./docs/images/log.png)
![指令中心](./docs/images/command.png)

## 技术栈

- 后端：Node.js + Express + TypeScript
- 前端：React 18 + TypeScript + Vite
- 数据库：SQLite（better-sqlite3）
- UI：TDesign React
- AI：@tencent-ai/agent-sdk

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 启动开发环境（前后端）

```bash
npm run dev
```

- 前端默认：`http://localhost:5173`
- 后端默认：`http://localhost:3000`

### 3) 构建

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

## 目录结构

```text
game-studio/
├── server/                 # 后端服务与 Agent 编排
│   ├── index.ts            # API 与 SSE 入口
│   ├── agent-manager.ts    # Agent 生命周期与消息分发
│   ├── tools.ts            # MCP 自定义工具
│   ├── agents.ts           # 团队角色定义与系统提示词
│   └── db.ts               # SQLite 表结构与数据访问
├── src/                    # 前端应用
│   ├── pages/StudioPage.tsx
│   ├── components/         # 各业务面板
│   ├── config.ts           # API 封装
│   └── types.ts            # 前后端共享业务类型
├── docs/images/            # README 预览图片
├── data/                   # SQLite 数据文件目录（运行时生成）
├── output/                 # 提案/游戏产出目录（运行时生成）
├── README.md
└── DEVELOPMENT.md
```

## API 概览

主要接口（前缀 `/api`）：

- 基础：`/health` `/models` `/check-login` `/observe`
- Agent：`/agents` `/agents/:agentId/messages` `/agents/:agentId/command` `/agents/:agentId/pause` `/agents/:agentId/resume`
- 提案：`/proposals` `/proposals/:id` `/proposals`(POST) `/proposals/:id/review` `/proposals/:id/decide`
- 游戏：`/games` `/games/:id` `/games`(POST) `/games/:id/preview` `/games/:id`(PATCH)
- 项目：`/projects`(GET/POST) `/projects/:id/settings`(GET/PATCH)
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

详见 [DEVELOPMENT.md](./DEVELOPMENT.md)。
