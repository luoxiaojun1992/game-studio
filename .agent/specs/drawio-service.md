# Draw.io 图表微服务规范

> **SPEC-016** | 状态：已实现

## 概述

Drawio service 为 game-studio 提供图表创建能力（流程图、架构图等）。架构复刻 creator service 模式：独立 FastAPI 容器 → HTTP → TS 客户端 → MCP 工具。

## 测试模式 Toggle

UI test 模式下需启用固定 `drawio_project_id`，避免 mock 链路中 UUID 不匹配：

| 环境变量 | 值 | 效果 |
|---------|-----|------|
| `DRAWIO_SERVICE_TEST_MODE` | `true`（仅 `docker-compose.ui-test.yml`） | `drawio_create_project` 使用固定 ID `drw-proj-001` |
| 未设置 | —（生产默认） | 正常 UUID 生成 |

> 当前 UI test 未 mock Draw.io 工具调用，toggle 为未来预留。

## 架构

参考 `.agent/memory/ARCHITECTURE.md` 中的 Drawio Service 章节。
