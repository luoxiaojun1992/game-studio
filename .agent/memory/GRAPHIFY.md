# Graphify — 代码库知识图谱使用指南

> **版本**: 0.8.37（skill 安装于 `.agent/skills/graphify/`）
> **预构建图谱**: `graphify-out/graph.json` — 1697 节点、2952 边、149 社区

## 概述

Graphify 将代码库转为可查询的知识图谱，支持社区检测、追溯审计（EXTRACTED/INFERRED/AMBIGUOUS），输出交互式 HTML、GraphRAG JSON 和 GRAPH_REPORT.md。

## 何时使用

当需要回答以下类型问题时，优先使用 graphify 而非手动搜索代码：

- "AuthModule 和 Database 之间有什么关联？"
- "有多少模块依赖 utils/helpers？"
- "agent_manager 的连接最集中在哪些社区？"
- "HTTPException 被哪些模块引用？"

## 快速使用

### 查询图谱
```bash
# BFS 广度遍历（获取广泛上下文）
graphify query "AgentManager 如何与 StarOffice Sync 关联？"

# DFS 深度遍历（追踪特定路径）
graphify query "提案的生命周期" --dfs

# 限制输出长度
graphify query "ImageMagick 架构" --budget 1500
```

### 节点路径与解释
```bash
# 两节点间最短路径
graphify path "AgentManager" "StarOffice Sync"

# 单节点解释
graphify explain "HTTPException"
```

### 增量更新
```bash
# 只重新提取变更文件
/Users/luoxiaojun/.local/bin/graphify . --update

# 重新聚类（图谱不变）
/Users/luoxiaojun/.local/bin/graphify . --cluster-only
```

## 已构建图谱概览（2026-06-11）

| 指标 | 值 |
|------|-----|
| 节点数 | 1,697 |
| 边数 | 2,952 |
| 社区数 | 149 |
| Corpus | 232 文件 (~460K words) |
| 提取来源 | 159 代码 + 54 文档 + 19 图片 |
| 提取方式 | 84% EXTRACTED · 16% INFERRED |

### 主要社区（Top 10）

| # | 社区 | 节点数 |
|---|------|--------|
| 1 | Image Microservice | 116 |
| 2 | Database Layer | 85 |
| 3 | Creator Microservice | 76 |
| 4 | DrawIO Microservice | 62 |
| 5 | Asset Checking Rules | 62 |
| 6 | Creator Service Client | 54 |
| 7 | Lint Checkers | 46 |
| 8 | Documentation | 44 |
| 9 | Image Microservice | 39 |
| 10 | StarOffice Sync | 30 |

### God Nodes（核心抽象，连接数最高）

| 节点 | 说明 |
|------|------|
| HTTPException | 跨微服务错误处理（30 条边） |
| useI18n() | 前端国际化钩子（29 条边） |
| ImageOperationResponse | 图片操作统一响应（26 条边） |
| Game Dev Studio | 项目根概念（23 条边） |
| AgentManager | Agent 管理器（22 条边） |
| CheckerResult | Lint 检查结果（22 条边） |

## 输出文件

| 文件 | 用途 |
|------|------|
| `graphify-out/graph.html` | 交互式可视化（浏览器直接打开） |
| `graphify-out/graph.json` | 原始图数据（GraphRAG 兼容） |
| `graphify-out/GRAPH_REPORT.md` | 审计报告（God Nodes、Surprising Connections、Suggested Questions） |
| `graphify-out/manifest.json` | 文件清单与哈希（供 --update 使用） |
| `graphify-out/cost.json` | Token 成本追踪 |

## 构建流程（如需重建）

```bash
cd game-dev-studio
/Users/luoxiaojun/.local/bin/graphify . --mode deep  # 深度模式（更多 INFERRED edges）
```

## 注意事项

- 图谱文件较大（~3MB graph.json），已通过 `.gitignore` 排除 `graphify-out/cache/`
- AST 提取支持 Python、TypeScript、JavaScript；语义提取需 LLM subagent
- 查询结果中 `source_location` 可直接定位源码行号
- INFERRED edges 置信度范围 0.55-0.95，低于 0.5 的标记为 AMBIGUOUS
