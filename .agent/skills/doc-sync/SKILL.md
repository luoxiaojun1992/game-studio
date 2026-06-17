---
name: doc-sync
description: |
  game-dev-studio 项目文档同步更新技能。在完成任何实质性代码变更后，
  强制执行全量文档遍历检查，确保 README、架构文档、spec、memory 等所有
  文档与最新代码一致。触发词：docs、文档、readme、更新文档、忘记更新、
  documentation update。
agent_created: true
---

# Doc Sync — 文档同步检查清单

## Overview

在所有实质性代码变更完成后，**强制执行**全量文档遍历检查。不依赖记忆，不"觉得应该更新了"——必须逐项对照代码变更核对每一份文档。

> **核心原则**：代码变 = 文档变。任何漏更新的文档都是 Bug。

## When to Use

**强制触发**（完成以下任一操作后必须运行）：
- 新增/修改微服务
- 新增/修改 MCP 工具
- 新增/修改 DB 表
- 新增/修改 Docker 服务/端口
- 新增/修改 E2E 测试用例
- 新增/修改 spec 文档
- 合并大分支到 `main`
- 架构图更新后

**可选触发**：
- 用户说"更新文档"、"同步文档"、"readme"、"docs"
- 用户指出某文档遗漏了更新

## 文档遍历清单

按以下顺序逐项检查，不可跳过。每项检查完成后在清单打 ✅。

### 区域 A：项目根目录（最常遗漏）

```
□ README.md
  - 功能概览段落：是否有新服务/新工具需要添加？
  - API 概览/MCP 工具列表：工具数量是否与 tools.ts 一致？
  - 目录结构：是否有新目录（如 video-service/）？
  - Spec 状态表：所有 SPEC 状态是否与实际一致？（设计中→已实现）
  - 环境变量列表：是否有新服务的 *_SERVICE_URL？
  - 快速开始/部署说明：新服务的 Docker 步骤？

□ README.zh-CN.md
  - 与 README.md 同步更新
```

### 区域 B：docs/ 目录（架构文档）

```
□ docs/ARCHITECTURE.md（英文）
  - 系统架构图引用：图片路径是否最新？
  - 服务列表：是否有新服务？
  - 技术栈表格：端口、依赖是否准确？
  - 数据流描述：是否包含新服务的交互？

□ docs/ARCHITECTURE.zh-CN.md（中文）
  - 与 ARCHITECTURE.md 同步更新

□ docs/BRAND.md / BRAND.zh-CN.md
  - 品牌/视觉资产引用是否有新增？

□ docs/DEVELOPMENT.md / DEVELOPMENT.zh-CN.md
  - 开发指南是否需要更新？
  - Docker 服务启动步骤是否有新服务？

□ docs/README-Docker.md / README-Docker.zh-CN.md
  - Docker 服务列表是否完整？
  - 端口映射表是否包含新服务？
  - compose 文件引用是否正确？
```

### 区域 C：.agent/memory/ 目录（内部知识库）

```
□ .agent/memory/INDEX.md
  - 快速参考的数字/列表是否一致？（工具数、服务数、表数等）
  - 新增 spec 或 memory 文件是否已索引？

□ .agent/memory/ARCHITECTURE.md
  - 关键模块详解：是否新增模块描述？
  - SDK Custom Tools：新工具类别是否列出？
  - 目录结构树：新目录是否添加？
  - DB 表列表：新表是否列出？
  - E2E 测试数量：是否与 cases.json 一致？
  - Docker 服务依赖图：新服务是否加入层级？
  - canUseTool 白名单：新工具前缀是否加入？

□ .agent/memory/CONVENTIONS.md
  - 是否有新约定需要写入？
  - 被纠正的错误做法：是否有新增条目？

□ .agent/memory/E2E_TESTING.md
  - 测试矩阵标题数字：实际用例数 vs 标题数字（高频失误点）
  - 测试矩阵表格：新增用例是否添加行？
  - data-testid 对照表：新组件是否添加？
  - coverage/cases.json：requiredCaseIds 是否包含新用例？

□ .agent/memory/MEMORY.md
  - 工程决策记录：本次变更是否有值得记录的决策？
  - 新服务/新模块的关键参数（端口、镜像、工具数）

□ .agent/memory/SDK_MOCK.md
  - Mock 数据契约：新增工具是否需要更新 mock？

□ .agent/memory/STAROFFICE.md
  - Star-Office 集成：新服务是否需要同步集成？
```

### 区域 D：.agent/specs/（设计文档）

```
□ .agent/specs/INDEX.md
  - 所有 spec 状态是否一致？（设计中/已实现）
  - 新 spec 是否已添加索引行？

□ .agent/specs/<affected-spec>.md
  - 如果本变更对应某个 spec，该 spec 状态是否已更新？
  - 实现细节是否与 spec 设计一致？
```

### 区域 E：.agent/ 根目录（项目总览）

```
□ .agent/AI_AGENT_COMMON_INSTRUCTIONS.md
  - 关键文件位置：新文件是否列出？
  - API 概览：新端点/新工具类别？
  - 端口列表：新服务端口？
  - Agent 配置：新工具权限白名单？
```

### 区域 F：工作区记忆（跨会话持久化）

```
□ .workbuddy/memory/MEMORY.md
  - 关键工程决策：本次变更的决策要点
  - 服务/工具/DB 等数字统计：是否需要更新？

□ .workbuddy/memory/YYYY-MM-DD.md
  - 每日工作日志：本次变更的摘要（append-only）
```

### 区域 G：架构图（视觉资产）

```
□ docs/images/architecture.svg
  - 新服务是否已添加到微服务层？
  - 工具数量是否与 tools.ts 一致？
  - 端口号是否正确？
  - 层级间箭头是否重新对齐？（添加新框后）

□ docs/images/architecture-en.svg
  - 英文版是否同步翻译？

□ docs/images/architecture.png / architecture-en.png
  - PNG 是否重新导出？（svg-to-png skill）
```

### 区域 H：知识图谱（代码结构可视化）

代码结构变更后，必须运行 `graphify update .` 重建知识图谱。该命令仅做 AST 结构提取（无需 LLM API key），自动复用已有语义数据。

```
□ graphify-out/graph.json
  - 是否已执行 graphify update . ？
  - 图谱的 HTML/Report 是否自动生成？

□ 执行 graphify update <项目根目录>
  - 该命令仅做 AST 提取，无需 LLM API key
  - 输出会显示节点/边/社区计数，人工确认数量级合理即可
    （如重构后节点数骤降 50% 则可能提取异常，需 --force 重试）
  - 增量检测无变化但代码已变更时，使用 --force 强制重写
```

> **Skill 引用**：更新图谱时加载 `graphify` skill 获取完整操作指引。不要通过硬编码路径调用 skill —— 使用 skill 的 name 标识符 `graphify` 加载即可。

## 变更影响矩阵

当以下变更发生时，MUST 更新对应的文档区域（参考上方区域编号）：

| 变更类型 | 必查区域 | 常见遗漏 |
|---------|---------|---------|
| 新微服务 | A, B1-B2, C2-C5, D-E, G, H | README spec 状态忘记改为"已实现" |
| 新 MCP 工具 | A, C1-C3, C6, H | 工具总数忘记更新 |
| 新 DB 表 | A, C2, H | docs/ 架构文档表列表 |
| 新 Docker 服务 | B5, C2（依赖图）, H | README-Docker 端口表 |
| 新 E2E 用例 | C4（3 处：标题+表格+case.json） | 标题数字（最高频失误） |
| 新 spec | D1-D2, H | .agent/specs/INDEX.md |
| 架构图变更 | G（全量：中英 SVG+PNG） | 英文版未翻译 + PNG 未导出 |
| 代码重构（无新服务） | H | 图谱未更新，节点/边数过时 |

## 工作流

### Step 1: 理解代码变更

```
1. 读取 git diff（或回顾本次会话的变更）
2. 列出所有受影响的核心文件（tools.ts, db.ts, docker-compose.yml, etc.）
3. 识别变更类型（对照上面的"变更影响矩阵"）
```

### Step 2: 对照清单逐项检查

```
1. 根据变更类型，确定必须检查的区域
2. 按 A→G 顺序逐项检查
3. 对每一行：
   a. 读取该文件的当前内容
   b. 判断是否需要更新
   c. 如需更新，立即执行 Edit
   d. 打 ✅
```

**关键规则**：
- 如果某区域没有对应文件（如 SDK_MOCK.md 可能不存在），打 ✅ 跳过即可
- 如果某文件不需要更新（如 BRAND.md 与本次变更无关），打 ✅ 跳过
- **反过来，如果变更类型矩阵说"必查"，你必须实际读完文件并确认不需要改，才能打 ✅**

### Step 3: 知识图谱更新（必须）

**任何实质性代码变更后都需要更新知识图谱**，确保 graphify-out/ 中的节点/边/社区数与最新代码一致。

```
1. 加载 graphify skill（使用 name: "graphify"，不硬编码路径）
2. 判断更新模式：
   - 代码结构变更（AST 层）→ 执行 graphify update .（无 LLM API key 需求）
   - 文档/图片内容变更（语义层）→ 需要完整 rebuild（需 API key）
   - 图谱已过期但 update 检测无变化 → 使用 --force
3. 执行更新命令，等待完成
4. 检查输出的最后一行统计数字，做 sanity check：
   命令执行完毕后会输出类似：
   [graphify] Rebuilt: 3195 nodes, 5098 edges, 253 communities
   - 只需扫一眼确认数量级合理：新增文件后节点数应上升，重构后与上次相差不大
   - 如果节点数骤降 50% 或边数为 0，说明提取异常，用 --force 重试
   - 不需要对比文件、不需要精确断言
5. 如果图谱数据异常，用 graphify update . --force 强制重写
```

> **调用方式**：使用 Skill 工具加载 `graphify` skill（by name），不通过文件路径引用。CMD 的 SKILL.md 中提供了 `--code-only`、`--update`、`--force` 等模式的详细说明和 CLI 命令对照。实际 CLI 调用统一为 `cd <项目根目录> && graphify update .`（AST-only 增量）。

### Step 4: 架构图更新（如涉及）

如果变更涉及新服务、新端口或层级结构变化：

```
1. 加载 architecture-diagram skill
2. 按 Phase 1-6 执行（研究→绘制→文字居中→SVG→PNG→翻译→PNG）
3. 参考 architecture-diagram 的 SKILL.md 中 Phase 2 的"架构文档同步"
```

### Step 5: Spec 更新（如涉及）

如果变更对应一个已知 spec：

```
1. 按 spec-writer skill 规范更新状态（设计中→已实现）
2. 同步更新 .agent/specs/INDEX.md
```

### Step 6: 验证

```
1. 检查所有被修改文件的 git diff，确认没有遗漏
2. 重点复查 README.md + E2E_TESTING.md（最高频遗漏）
3. 提交
```

## 常见遗漏 Top 10

1. **README.md spec 状态未更新**（SPEC-XXX 已是"已实现"但 README 还写"设计中"）
2. **README.md/README.zh-CN.md 工具/服务总数未更新**
3. **E2E_TESTING.md 标题数字**（"13 个用例"写成"12 个用例"）
4. **docs/ARCHITECTURE.md 服务列表**未加新服务
5. **.agent/memory/ARCHITECTURE.md** 目录树未加新目录
6. **architecture-en.svg 英文版未翻译**
7. **architecture.png 未重新导出**
8. **.agent/specs/INDEX.md spec 状态不一致**
9. **.agent/AI_AGENT_COMMON_INSTRUCTIONS.md** 端口/工具列表未更新
10. **docs/README-Docker.md** 端口映射表未更新

## 格式约定

- **中文内容**：.agent/memory/ 和 .workbuddy/memory/ 文档用中文
- **英文内容**：README.md、docs/ARCHITECTURE.md 用英文
- **双语文档**：README.zh-CN.md、ARCHITECTURE.zh-CN.md 需与英文版同步
- **代码/文件名**：保持原始英文
- **COMMIT 消息**：`docs: <英文简短描述>`

## 引用的外部 Skill

本 skill 在特定阶段会引用以下已有 skill：

| Skill | 使用场景 | 触发阶段 |
|-------|---------|---------|
| `graphify` | 知识图谱更新（AST + 语义数据合并） | 任何代码变更后（Step 3） |
| `architecture-diagram` | 架构图绘制/更新 | 涉及层结构、新服务、新端口时 |
| `spec-writer` | Spec 文档编写/更新 | 涉及 spec 状态变更时 |
| `svg-to-png` | SVG→PNG 转换 | 架构图更新后 |

## 参考

- `.agent/memory/ARCHITECTURE.md` — 完整架构文档（最权威的参考答案）
- `.agent/memory/CONVENTIONS.md` — "主动更新所有相关文档"规范（第 20-32 行）
- `docs/ARCHITECTURE.md` — 对外架构文档
