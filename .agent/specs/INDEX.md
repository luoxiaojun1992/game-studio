# Spec 索引

本目录下所有设计规范文档的唯一编号索引。

## 编号规则

- 格式：`SPEC-XXX`，三位数字从 `001` 递增
- 每个独立设计文档一个编号，生命周期内不变
- game-framework-spec 子目录下的文档属于同一功能域，但各自独立编号

---

## 索引表

| 编号 | 标题 | 文件路径 | 状态 |
|------|------|---------|------|
| SPEC-001 | 提案内容 XSS 安全过滤规范 | [proposal-xss-sanitize.md](proposal-xss-sanitize.md) | 已实现 |
| SPEC-002 | 游戏工程规范 — 公共部分 | [game-framework-spec/GAME_ENGINEERING_COMMON.md](game-framework-spec/GAME_ENGINEERING_COMMON.md) | 已实现 |
| SPEC-003 | 游戏工程规范工具（Game Engineering Framework Tool） | [game-framework-spec/GAME_ENGINEERING_FRAMEWORK_TOOL.md](game-framework-spec/GAME_ENGINEERING_FRAMEWORK_TOOL.md) | 已实现 |
| SPEC-004 | 游戏工程规范检查器（Game Engineering Framework Checker） | [game-framework-spec/GAME_ENGINEERING_FRAMEWORK_CHECKER.md](game-framework-spec/GAME_ENGINEERING_FRAMEWORK_CHECKER.md) | 已实现 |
| SPEC-005 | H5 小游戏工程规范 | [game-framework-spec/H5_GAME_ENGINEERING_FRAMEWORK.md](game-framework-spec/H5_GAME_ENGINEERING_FRAMEWORK.md) | 已实现 |
| SPEC-006 | 游戏成品提交与 Lint 功能变更计划 | [game-submission-lint-change-plan.md](game-submission-lint-change-plan.md) | 已实现 |
| SPEC-007 | 基于问卷的游戏策划案提交功能规范 | [questionnaire-proposal.md](questionnaire-proposal.md) | 已实现 |
| SPEC-008 | ImageMagick 图片处理微服务规范 | [image-service.md](image-service.md) | 已实现 |
| SPEC-009 | FFmpeg 视频处理微服务规范 | [video-service.md](video-service.md) | 已实现 |
| SPEC-010 | Phaser Mobile 游戏工程规范 | [game-framework-spec/PHASER_MOBILE_GAME_ENGINEERING_FRAMEWORK.md](game-framework-spec/PHASER_MOBILE_GAME_ENGINEERING_FRAMEWORK.md) | 已实现 |
| SPEC-011 | 游戏打包微服务规范 | [build-service.md](build-service.md) | 设计中 |
| SPEC-012 | 游戏运行微服务规范 | [run-service.md](run-service.md) | 设计中 |
| SPEC-013 | 游戏测试微服务规范 | [test-service.md](test-service.md) | 设计中 |
| SPEC-014 | GitHub Actions CI Agent 规范 | [github-ci-agent.md](github-ci-agent.md) | 已实现 |
| SPEC-015 | Creator (Blender) 建模微服务规范 | [creator-service.md](creator-service.md) | 已实现 |
| SPEC-016 | Draw.io 图表微服务规范 | [drawio-service.md](drawio-service.md) | 已实现 |
| SPEC-017 | Tool Search — 工具搜索与元数据分离 | [tool-search.md](tool-search.md) | 设计中 |
| SPEC-018 | 分层架构重构规范 | [layered-architecture.md](layered-architecture.md) | 设计中 |
| SPEC-019 | Tool Call Chain — Agent 工具调用链可视化 | [tool-call-chain.md](tool-call-chain.md) | 设计中 |
| SPEC-020 | OpenTelemetry 分布式链路追踪 | [opentelemetry-tracing/opentelemetry-tracing.md](opentelemetry-tracing/opentelemetry-tracing.md) | 设计中 |
| SPEC-021 | Team Building Agent 指示灯 | [team-building-agent-indicator-light/spec.md](team-building-agent-indicator-light/spec.md) | 设计中 |

---

## 新增 Spec 流程

1. 在索引表中分配下一个可用编号
2. 创建 `.md` 文件，在文件头部标题下方添加编号标识：

```markdown
# 标题

> **SPEC-XXX** | 状态：设计中

## 目标
...
```

3. 更新本索引表，填写标题、路径、状态
4. **spec 实现后强制执行**：加载 `.agent/skills/doc-sync/SKILL.md` 遍历 A→G 区域同步所有相关文档（README、架构文档、memory、架构图等）。详见 `.agent/skills/spec-writer/SKILL.md` 中 Step 6。
