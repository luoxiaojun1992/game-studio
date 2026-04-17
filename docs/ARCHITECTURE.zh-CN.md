# Game Dev Studio 架构文档

[English](./ARCHITECTURE.md)

本文描述 Game Dev Studio 当前实现的整体架构，包括系统边界、模块职责与关键运行链路。

## 1. 系统范围

Game Dev Studio 是一个多 Agent 游戏研发工作台，包含：

- 用于协作与观测的前端应用
- 负责编排与持久化的后端 API/SSE 服务
- 基于 `@tencent-ai/agent-sdk` 的 Agent 运行时集成
- 可选的 Star-Office-UI 双向状态同步

## 2. 高层架构

```text
浏览器 (React + Vite)
  ├─ HTTP/REST  ───────────────┐
  └─ SSE (/api/observe) ───────┤
                                ▼
                       后端 (Express + TypeScript)
                       ├─ Agent Manager / Tool Runtime
                       ├─ Project + Proposal + Task + Handoff APIs
                       ├─ Game Artifact APIs
                       ├─ 日志/事件广播 (SSE)
                       ├─ SQLite 持久化
                       └─ Star-Office 同步服务
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
        data/studio.db                     output/{project_id}/...
```

## 3. 运行时组件

### 3.1 前端（`src/`）

- 主页面：`src/pages/StudioPage.tsx`
- 业务面板：`src/components/*`
- API 封装层：`src/config.ts`
- 共享类型：`src/types.ts`
- 通过 SSE 订阅后端事件，保持前端状态与运行时一致

### 3.2 后端（`server/`）

- `index.ts`：API 入口、SSE 入口、路由装配、静态产物服务
- `agent-manager.ts`：Agent 生命周期、指令分发、流式事件
- `tools.ts`：MCP 自定义工具定义与角色约束
- `agents.ts`：角色定义、提示词、交接约束
- `db.ts`：SQLite 表结构、迁移、读写逻辑
- `sse-broadcaster.ts`：SSE 客户端管理与事件广播
- `star-office-sync.ts`：Star-Office 注册/同步/健康巡检

## 4. 核心业务域

- **项目（Projects）**：项目生命周期、项目切换、项目设置
- **Agent（Agents）**：基于角色的协作与指令执行
- **提案（Proposals）**：提案创建、评审流转、决策状态
- **任务（Tasks）**：开发/测试任务拆分与状态流转
- **交接（Handoffs）**：跨角色任务移交与确认执行
- **产物（Games）**：HTML 成品提交、列表与预览
- **记忆（Memories）**：按角色/项目组织的长期记忆
- **观测（Logs/Events）**：运行日志与事件流
- **权限（Permissions）**：工具执行审批流与回调响应

## 5. 数据与存储

- 主存储：SQLite（`data/studio.db`）
- 主要表包括：
  - `projects`
  - `project_settings`
  - `agent_sessions`、`agent_messages`
  - `proposals`
  - `task_board_tasks`
  - `handoffs`
  - `games`
  - `agent_memories`
  - `logs`
  - `commands`
  - `permission_requests`
- 提案/游戏产物写入 `output/{project_id}/...`
- 数据与产物按 `project_id` 隔离

## 6. 通信模型

### 6.1 请求-响应

- 前端通过 `/api/*` 调用后端
- 后端完成校验、状态更新、持久化后返回标准化数据

### 6.2 事件流

- 前端订阅 `/api/observe`（SSE）
- 后端推送关键领域事件，例如：
  - agent 状态/日志/流式输出
  - proposal/task/handoff/game 生命周期更新

## 7. 集成架构（Star-Office-UI）

- 前端通过独立面板内嵌 Star-Office-UI
- 后端负责与 Star-Office 端点进行服务端同步
- 支持防抖同步与健康巡检
- 端点基于 `STAR_OFFICE_UI_URL` 推导（`/set_state`、`/agent-push`、`/join-agent`、`/agents`、`/health`）

## 8. 安全与隔离要点

- 通过 `project_id` 实现项目级数据与事件隔离
- 路由统一在 `/api/*` 命名空间下管理
- 产物文件受限于受管控的输出目录
- 工具调用受角色权限与工作流规则约束

## 9. 部署形态

- 本地开发：单节点后端 + 前端开发服务器
- Docker 部署：前后端容器化（见 `README-Docker.zh-CN.md`）
- 运行目录：
  - `data/`：SQLite 数据库
  - `output/`：提案/游戏产物

## 10. 扩展原则

- 新功能需同步对齐 API、数据模型与 SSE 事件
- 新增领域对象必须保持项目隔离语义
- 调整 Agent 工作流时同步更新角色提示词与工具约束
- 修改持久化结构或产物路径时保持向后兼容
