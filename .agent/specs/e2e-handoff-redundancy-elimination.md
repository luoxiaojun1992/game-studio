# E2E 全流程测试冗余交接链消除

> **SPEC-023** | 状态：已实现

## 目标

消除 E2E 测试中 UI-011/UI-012/UI-013 三个用例的冗余交接链（game_designer→ceo→architect→engineer），将其重构为"工程师直达"模式，保持所有测试逻辑严格不变，仅移除不提供增量覆盖的 handoff 步骤。

## 背景

### 现状

当前 E2E 测试套件（16 个用例）中有 5 个全流程测试用例共享 `runFullWorkflowTest()` 函数，均执行相同的 3 步交接链：

```
game_designer --create_handoff--> ceo --create_handoff--> architect --create_handoff--> engineer
```

**问题**：

1. **交接链冗余**：UI-011（phaser-mobile）、UI-012（image processing）、UI-013（video processing）的核心测试目标分别是游戏类型差异、图片服务工具链、视频服务工具链，与交接链本身无关
2. **执行时间膨胀**：每个全流程测试需要完成 3 次 handoff（accept→confirm→dispatch→LLM→response），每次 ~10-30s，累计增加 30-90s 无意义等待
3. **交接链已充分覆盖**：UI-007（manual）+ UI-008（autopilot）已经完整验证了两种模式下的交接逻辑，不需要 UI-011/012/013 重复验证

### 冗余分析

| 测试 | 交接链逻辑 | 独特测试价值 | 冗余部分 |
|:---|:---|:---|:---|
| UI-007 | ✅ 手动交接 | Manual mode（不可移除） | — |
| UI-008 | ✅ 自动交接 | Autopilot mode（不可移除） | — |
| **UI-011** | 同 UI-007 | phaser-mobile gameType 差异 | **交接链完全冗余** |
| **UI-012** | 同 UI-007 | image service 19 步工具链 | **交接链完全冗余** |
| **UI-013** | 同 UI-007 | video service 10 步工具链 | **交接链完全冗余** |

## 详细设计

### 1. 重构策略

**保留 UI-007、UI-008 不变** — 这两个是全流程交接的唯一真实覆盖。

**重构 UI-011/012/013** — 从 `runFullWorkflowTest` 切换为新的 `runEngineerDirectTest`：

```
旧：game_designer → [3 handoffs] → engineer (大量 mock, 含 handoff accept/confirm 循环)
新：engineer (同样的 engineer mock, 简化的权限+游戏计数循环, 无 handoff 步骤)
```

### 2. 新增辅助函数：`runEngineerDirectTest`

从 `runFullWorkflowTest` 中提取 engineer 专属 mock 队列逻辑，创建独立的轻量测试函数。

```typescript
interface EngineerDirectOptions {
  testId: string;
  gameType?: 'h5' | 'phaser-mobile';
  withImageProcessing?: boolean;
  withVideoProcessing?: boolean;
}

const runEngineerDirectTest = async (page, opts: EngineerDirectOptions) => {
  // 1. 创建项目（复用现有逻辑）
  // 2. 队列 engineer mock（复用 queueEngineerMocks 提取函数）
  // 3. 发送指令到 engineer（非 game_designer）
  // 4. 简化事件循环：只检查权限 + 游戏计数，无 handoff 处理
  //    - 退出条件: gameCount >= 1
  //    - 没有 handoff accept/confirm 步骤
  //    - 没有 tab-handoffs 切换
  //    - 没有 cardCount 检查
};
```

### 3. 提取公共 Mock 队列函数

将 engineer 的 mock 队列逻辑从 `runFullWorkflowTest`（~880 行）中提取为独立函数 `queueEngineerMocks`：

```typescript
const queueEngineerMocks = async (
  projectId: string,
  gameType: 'h5' | 'phaser-mobile',
  withImageProcessing?: boolean,
  withVideoProcessing?: boolean
) => {
  // get_game_types
  // get_game_framework_spec(gameType)
  // get_common_spec
  // write_game_file × N (gameType 决定内容)
  // [withImageProcessing → 19 image mocks]
  // [withVideoProcessing → 10 video mocks]
  // submit_proposal
  // submit_game
  // save_memory
  // expectText final
};
```

`runFullWorkflowTest` 调用：`queueEngineerMocks(...)` + 前面 append 3 个 handoff mock
`runEngineerDirectTest` 调用：`queueEngineerMocks(...)` 即可

### 4. 测试逻辑对比

**保持严格不变的部分**（逐字节相同的 mock 内容）：
- `get_game_types` / `get_game_framework_spec` / `get_common_spec` 的参数
- `write_game_file` 的文件路径和内容（phaser-mobile 的 game.js/phaser.min.js/capacitor.config.json，H5 的 index.html/metadata.json/manifest.json）
- image 处理 19 个 mock 步骤（含 1x1 PNG base64）
- video 处理 10 个 mock 步骤（含 2-frame GIF base64）
- `submit_proposal` / `submit_game` / `save_memory` 的参数
- 最终 `expectText` 内容

**移除的部分**：
- 3 个 `expectHandoff()` mock 调用（game_designer→ceo, ceo→architect, architect→engineer）
- 事件循环中的 `tryAcceptAnyPending()` / `tryConfirmAnyAccepted()` 步骤
- `switchTab('tab-handoffs')` + `cardCount >= 3` 检查
- `autopilot` 选项（不再需要）

**简化的部分**：
- 事件循环退出条件：`cardCount >= 3 && gameCount >= 1` → `gameCount >= 1`
- 发送指令目标 agent：game_designer → engineer
- 指令文本：游戏设计指令 → 工程实现指令（如"请构建一个 H5 游戏"）
- 超时时间：可适当缩短（无 handoff 等待）

### 5. 事件循环变更

```
旧循环（5 步）：
  1. check permission
  2. accept pending handoff (manual only)
  3. confirm accepted handoff (manual only)
  4. count handoff cards → switch to tab-handoffs
  5. count games → switch to tab-games
  退出：cardCount >= 3 && gameCount >= 1

新循环（3 步）：
  1. check permission
  2. count games → switch to tab-games
  退出：gameCount >= 1
```

### 6. E2E 测试矩阵更新

| 用例 ID | 变更前 | 变更后 | 类别变更 |
|:---|:---|:---|:---|
| UI-007 | 全流程手动 | **不变** | 完整工作流（手动） |
| UI-008 | 全流程自动 | **不变** | 完整工作流（自动） |
| UI-011 | 全流程 phaser-mobile | **工程师直达** phaser-mobile | 游戏类型验证 |
| UI-012 | 全流程 image processing | **工程师直达** image processing | 图片服务工具链 |
| UI-013 | 全流程 video processing | **工程师直达** video processing | 视频服务工具链 |

## 可行性分析

| 检查项 | 结论 |
|--------|------|
| 是否需要后端改动 | 否 — 仅修改测试代码 |
| 数据是否已存在 | N/A |
| 是否需要新 DB 表 | 否 |
| 是否影响现有功能 | 否 — 仅减少测试的交接等待时间 |
| 性能影响 | **正面** — 每个重构用例减少 30-90s 执行时间 |
| 是否需要新增 SSE 事件 | 否 |
| 是否需要 E2E 测试 | 是 — 但仅重构现有用例，不新增 |

### 结论

纯测试层重构，无后端/前端变更。可实现，无风险。

## 相关文件

| 文件 | 角色 | 变更幅度 |
|------|------|---------|
| `tests/ui/e2e/studio.spec.ts` | 新增 `runEngineerDirectTest` + 提取 `queueEngineerMocks` + 重构 UI-011/012/013 | 中（~150 行新增，~100 行删除） |
| `.agent/memory/E2E_TESTING.md` | 更新 UI-011/012/013 章节 + 测试矩阵描述 | 低（~50 行修改） |
| `.agent/specs/INDEX.md` | 新增 SPEC-023 | 低（1 行新增） |
| `.agent/memory/MEMORY.md` | 记录工程决策 | 低（1 行新增） |

## UI Test 验收规则

提交代码前必须跑通 ui test。

如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

重构完成后必须同步更新：
1. `tests/ui/e2e/studio.spec.ts` — 重构 UI-011/012/013 测试用例
2. `.agent/memory/E2E_TESTING.md` — 更新 UI-011/012/013 章节描述 + 测试矩阵表格（测例数保持 16 不变）
3. `.agent/specs/e2e-handoff-redundancy-elimination.md` — 本文档状态更新为「已实现」

**⚠️ 测例数**：本次为重构（非新增/删除），测例总数保持 16 不变，`E2E_TESTING.md` 标题数字无需修改。

## 详细 Debug 日志规范

### E2E 测试日志

UI-011（重构后）：
```
[UI-011] step1: create project
[UI-011] step2: queue engineer mocks (phaser-mobile)
[UI-011] step3: send command to engineer
[UI-011] step4: event loop start
[UI-011] step5: target reached (gameCount=1)
[UI-011] test:passed
```

UI-012/013 同理，前缀替换为 `UI-012` / `UI-013`。

## 验证标准

1. UI-007 和 UI-008 测试行为完全不变（手工对比 diff，确保 `runFullWorkflowTest` 调用未变）
2. UI-011/012/013 的 mock 内容与重构前逐字节一致（比对 mock body 中的 `toolCalls.arguments`）
3. UI-011/012/013 不再创建任何 handoff card（循环中无 handoff accept/confirm，`cardCount` 始终为 0）
4. UI-011/012/013 的游戏卡片创建逻辑不变（`gameCount >= 1` 验证通过）
5. `coverage/cases.json` 保持 16 个 requiredCaseIds 不变
6. E2E 全量测试通过（13 非全流程 + 2 全流程 + 1 build service = 16/16）

## 注意事项

- **Mock 参数严格不变**：`get_game_framework_spec` 的 `game_type` 参数、`write_game_file` 的 `path` 和 `content` 字段必须逐字节一致。使用代码提取 + 复用方式确保。
- **事件循环超时**：简化后的循环超时仍使用 `UI_TEST_LOOP_TIMEOUT_MS` 环境变量，默认 600s（实际执行时间大幅缩短，但保留足够余量）。
- **指令文本**：重构后指令直接发给 engineer，内容改为更适合工程师的工程实现指令，如"请构建一个 H5 游戏，包含完整的 dist/ 目录结构"。
- **保留 `gameType` 参数**：UI-011 的 `gameType: 'phaser-mobile'` 参数传递路径从 `runFullWorkflowTest` 迁移到 `runEngineerDirectTest`，在 `queueEngineerMocks` 中消费。
