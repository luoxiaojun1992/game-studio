# 流程图索引（PlantUML）

本目录用于沉淀游戏开发流程相关的 **原生 PlantUML** 图。

## 目录约定

- 每个流程独立一个 `.puml` 文件，便于后续增量补充。
- 文件名建议：`<领域>-<流程名>-<约束>.puml`（例如：`game-dev-main-flow-manual-handoff.puml`）。
- 在图中为关键步骤标注对应代码路径（必要时包含行号范围）。

## 当前流程图

1. `game-dev-main-flow-manual-handoff.puml`
   - 游戏开发主流程（从给商业策划下指令到提交游戏成品）
   - 约束：不使用 autopilot（手动接收/确认交接）
