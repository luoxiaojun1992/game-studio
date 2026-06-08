# Blender 3D 建模微服务规范

> **SPEC-015** | 状态：已实现

## 概述

Creator service (Blender) 是 game-studio 的第一个微服务，作为后续所有微服务的参考架构模板。提供 3D 建模能力：创建几何体、PBR 材质、布尔操作、模型导出等。

## 测试模式 Toggle

UI test 模式下需启用固定 `blender_project_id`，避免 mock 链路中 UUID 不匹配：

| 环境变量 | 值 | 效果 |
|---------|-----|------|
| `CREATOR_SERVICE_TEST_MODE` | `true`（仅 `docker-compose.ui-test.yml`） | `blender_create_project` 使用固定 ID `bld-proj-001` |
| 未设置 | —（生产默认） | 正常 UUID 生成 |

> 当前 UI test 未 mock Blender 工具调用，toggle 为未来预留。

## 架构

参考 `.agent/memory/ARCHITECTURE.md` 中的 Creator Service 章节。
